package events

import (
	"log/slog"
	"sync"
)

// AgentEventBufferSize is the live event channel buffer size.
const AgentEventBufferSize = 512

// AgentEventBroker fans out persisted agent events to live subscribers.
type AgentEventBroker struct {
	mu          sync.RWMutex
	subscribers map[chan AgentEvent]struct{}
	persist     func(AgentEvent) (AgentEvent, error)
	normalize   func(AgentEvent) AgentEvent
}

// NewAgentEventBroker returns an initialized agent event broker.
func NewAgentEventBroker(
	normalize func(AgentEvent) AgentEvent,
	persist ...func(AgentEvent) (AgentEvent, error),
) *AgentEventBroker {
	var persistEvent func(AgentEvent) (AgentEvent, error)
	if len(persist) > 0 {
		persistEvent = persist[0]
	}
	return &AgentEventBroker{
		subscribers: map[chan AgentEvent]struct{}{},
		persist:     persistEvent,
		normalize:   normalize,
	}
}

// Subscribe subscribes to live agent events.
func (broker *AgentEventBroker) Subscribe() (<-chan AgentEvent, func()) {
	events := make(chan AgentEvent, AgentEventBufferSize)

	broker.mu.Lock()
	broker.subscribers[events] = struct{}{}
	subscriberCount := len(broker.subscribers)
	broker.mu.Unlock()
	slog.Debug("agent event subscriber added", "subscribers", subscriberCount, "buffer_size", cap(events))

	return events, func() {
		broker.mu.Lock()
		delete(broker.subscribers, events)
		subscriberCount := len(broker.subscribers)
		broker.mu.Unlock()
		slog.Debug("agent event subscriber removed", "subscribers", subscriberCount)
	}
}

// Publish publishes a live agent event.
func (broker *AgentEventBroker) Publish(event AgentEvent) {
	if broker.normalize != nil {
		event = broker.normalize(event)
	}
	if broker.persist != nil && shouldPersistAgentEvent(event.Type) {
		persisted, err := broker.persist(event)
		if err != nil {
			slog.Warn(
				"agent event persistence failed",
				"type", event.Type,
				"session_id", event.SessionID,
				"run_id", event.RunID,
				"error", err,
			)
		} else {
			event = persisted
		}
	}

	broker.mu.RLock()
	defer broker.mu.RUnlock()

	for subscriber := range broker.subscribers {
		if IsGuaranteedAgentEventPayload(event) {
			publishGuaranteedAgentEvent(subscriber, event)
			continue
		}

		select {
		case subscriber <- event:
		default:
			slog.Warn("agent event dropped", "type", event.Type, "session_id", event.SessionID, "run_id", event.RunID)
		}
	}
}

// shouldPersistAgentEvent reports whether an event type is written to the
// session history log. The `agent.session.connected` frame is a per-connection
// control event, and `agent.message.delta` is high-volume streaming text fully
// superseded by the terminal `agent.message.completed` payload; persisting
// deltas would bloat the log and slow replay without adding recoverable state.
func shouldPersistAgentEvent(eventType string) bool {
	switch eventType {
	case "agent.session.connected", "agent.message.delta":
		return false
	default:
		return true
	}
}

func publishGuaranteedAgentEvent(subscriber chan AgentEvent, event AgentEvent) {
	for attempts := 0; attempts <= cap(subscriber); attempts++ {
		select {
		case subscriber <- event:
			return
		default:
		}

		select {
		case dropped := <-subscriber:
			slog.Warn(
				"agent event buffer full; dropped older event for guaranteed event",
				"dropped_type", dropped.Type,
				"guaranteed_type", event.Type,
				"session_id", event.SessionID,
				"run_id", event.RunID,
			)
		default:
			return
		}
	}
}
