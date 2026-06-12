package events

import "testing"

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
