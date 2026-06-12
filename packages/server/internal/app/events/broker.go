package events

import (
	serviceagent "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
	serviceevents "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/events"
)

// Event aliases the agent event shape used by the service layer.
type Event = serviceagent.AgentEvent

// EventPublisher publishes agent events.
type EventPublisher interface {
	PublishEvent(event Event)
}

// Broker fans out live agent events and optionally persists them.
type Broker struct {
	broker *serviceevents.AgentEventBroker
}

// NewBroker creates an agent event broker.
func NewBroker(persist ...func(Event) (Event, error)) *Broker {
	return &Broker{broker: serviceevents.NewAgentEventBroker(normalizeLiveAgentEvent, persist...)}
}

// Subscribe returns a channel of live agent events.
func (broker *Broker) Subscribe() (<-chan Event, func()) {
	return broker.broker.Subscribe()
}

// PublishEvent publishes one event.
func (broker *Broker) PublishEvent(event Event) {
	broker.Publish(event)
}

// Publish publishes one event.
func (broker *Broker) Publish(event Event) {
	broker.broker.Publish(event)
}

func normalizeLiveAgentEvent(event Event) Event {
	event = serviceagent.NormalizeAgentEventForPersistence(event)
	return event
}
