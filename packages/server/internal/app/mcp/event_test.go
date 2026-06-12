package mcp

import (
	"context"
	"testing"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	cliservice "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
)

type recordingAgentEventPublisher struct {
	events []agentEvent
}

func (publisher *recordingAgentEventPublisher) PublishEvent(event agentEvent) {
	publisher.events = append(publisher.events, event)
}

func TestMCPAdapterPublishAgentEventPublishesDocumentSelection(t *testing.T) {
	publisher := &recordingAgentEventPublisher{}
	adapter := NewAdapter(nil, publisher)
	adapter.document = &DocumentServer{
		projectID: "project-events",
		config: DocumentConfig{
			RunID:    "run-1",
			AgentTag: "writer",
		},
	}

	err := adapter.PublishAgentEvent(context.Background(), "project-events", mediamcp.AgentDocumentSelectionEvent{
		DocumentID: "doc-1",
		Selection: mediamcp.DocumentRangeSelection{
			BlockID: "block-1",
			Range:   mediamcp.DocumentTextRange{Start: 0, End: 2},
		},
	})
	if err != nil {
		t.Fatalf("PublishAgentEvent(selection) returned error: %v", err)
	}
	if len(publisher.events) != 1 {
		t.Fatalf("events = %#v, want 1 event", publisher.events)
	}
	selectionEvent := publisher.events[0]
	if selectionEvent.Type != cliservice.AgentDocumentSelectionSetEventType ||
		selectionEvent.DocumentSelection == nil ||
		selectionEvent.DocumentSelection.RunID != "run-1" ||
		selectionEvent.DocumentSelection.AgentTag != "writer" {
		t.Fatalf("selection event = %#v, want decorated selection event", selectionEvent)
	}
}

func TestMCPAdapterPublishAgentEventRejectsNilEvent(t *testing.T) {
	adapter := NewAdapter(nil, &recordingAgentEventPublisher{})
	var event mediamcp.AgentDocumentEvent
	if err := adapter.PublishAgentEvent(context.Background(), "project-events", event); err == nil {
		t.Fatal("PublishAgentEvent returned nil error, want nil event error")
	}
}
