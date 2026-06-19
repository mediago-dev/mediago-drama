package agent

import "testing"

func TestAgentEventBusDecoratesAndPublishesInOrder(t *testing.T) {
	events := []AgentEvent{}
	bus := NewAgentEventBus(AgentEventContext{
		SessionID: "session-1",
		ProjectID: "project-1",
		RunID:     "run-1",
		AgentTag:  "MediaGo Drama Agent",
	}, func(event AgentEvent) {
		events = append(events, event)
	})

	bus.PublishEvent(AgentEvent{Type: "agent.activity", Message: "first"})
	bus.PublishEvent(AgentEvent{
		Type:    "agent.document.edit.delta",
		Message: "second",
		DocumentEdit: &AgentDocumentEditEvent{
			DocumentID: "doc-1",
			Mode:       "append",
			Delta:      "text",
		},
	})

	if len(events) != 2 {
		t.Fatalf("events = %#v, want two events", events)
	}
	if events[0].Message != "first" || events[1].Message != "second" {
		t.Fatalf("events = %#v, want publish order preserved", events)
	}
	if events[1].SessionID != "session-1" || events[1].RunID != "run-1" {
		t.Fatalf("event identity = %#v, want decorated session/run", events[1])
	}
	if events[1].DocumentEdit.AgentTag != "MediaGo Drama Agent" {
		t.Fatalf("document edit = %#v, want fixed agent tag", events[1].DocumentEdit)
	}
}
