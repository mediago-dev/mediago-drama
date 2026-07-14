package events

import (
	"errors"
	"testing"
)

func TestEventBrokerPersistsDeltaBeforeFanOut(t *testing.T) {
	persisted := []string{}
	var nextSequence int64
	persist := func(event AgentEvent) (AgentEvent, error) {
		persisted = append(persisted, event.Type)
		nextSequence++
		event.Sequence = nextSequence
		return event, nil
	}
	broker := NewAgentEventBroker(nil, persist)
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	broker.Publish(AgentEvent{Type: "agent.message.delta", Delta: "正在改写"})
	broker.Publish(AgentEvent{Type: "agent.message.completed", Content: "改写完成"})

	delta := <-events
	if delta.Type != "agent.message.delta" {
		t.Fatalf("first event = %q, want agent.message.delta", delta.Type)
	}
	if delta.Sequence != 1 {
		t.Fatalf("delta sequence = %d, want persisted sequence 1", delta.Sequence)
	}

	completed := <-events
	if completed.Type != "agent.message.completed" || completed.Sequence != 2 {
		t.Fatalf("completed event = %#v, want persisted sequence 2", completed)
	}

	if len(persisted) != 2 || persisted[0] != "agent.message.delta" || persisted[1] != "agent.message.completed" {
		t.Fatalf("persisted = %v, want delta and completed in order", persisted)
	}
}

func TestEventBrokerNeverFansOutUnpersistedPositiveSequence(t *testing.T) {
	broker := NewAgentEventBroker(nil, func(event AgentEvent) (AgentEvent, error) {
		return event, errors.New("storage unavailable")
	})
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	broker.Publish(AgentEvent{Type: "agent.message.delta", Sequence: 99, Delta: "处理中"})

	event := <-events
	if event.Sequence != 0 {
		t.Fatalf("event = %#v, want sequence cleared after persistence failure", event)
	}
}

func TestEventBrokerPreservesGuaranteedAgentEvents(t *testing.T) {
	broker := NewAgentEventBroker(nil)
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	for range AgentEventBufferSize {
		broker.Publish(AgentEvent{Type: "agent.activity", Message: "activity"})
	}
	broker.Publish(AgentEvent{Type: "agent.activity", Message: "dropped activity"})
	broker.Publish(AgentEvent{Type: "agent.run.completed", Message: "done"})

	for range AgentEventBufferSize {
		event := <-events
		if event.Type == "agent.run.completed" {
			return
		}
	}

	t.Fatal("agent.run.completed was not delivered from a full event buffer")
}
