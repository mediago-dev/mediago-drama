package events_test

import (
	"testing"

	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicemodel "github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

func TestLoadAgentEventsReplaysExternalProjectEvents(t *testing.T) {
	store := appworkspace.NewStateService(t.TempDir())
	if store.InitErr() != nil {
		t.Fatalf("initializing workspace store: %v", store.InitErr())
	}
	projectID := "project-replay"
	if _, err := store.CreateProject(projectID, servicemodel.CreateWorkspaceProjectRequest{
		Name: "Replay",
	}); err != nil {
		t.Fatalf("creating project: %v", err)
	}
	if _, err := store.AppendAgentEvent(serviceagent.AgentEvent{
		SessionID: "session-1",
		ProjectID: projectID,
		Type:      "agent.document.edit.completed",
		Message:   "external edit",
		DocumentEdit: &serviceagent.AgentDocumentEditEvent{
			DocumentID: "doc-1",
			Status:     "completed",
		},
	}); err != nil {
		t.Fatalf("appending external event: %v", err)
	}
	if _, err := store.AppendAgentEvent(serviceagent.AgentEvent{
		SessionID: "session-1",
		ProjectID: projectID,
		Type:      "agent.run.completed",
		Message:   "done",
	}); err != nil {
		t.Fatalf("appending session event: %v", err)
	}

	replayed, err := store.LoadAgentEvents(projectID, "session-1", 0, 10)
	if err != nil {
		t.Fatalf("loading replayed events: %v", err)
	}
	if len(replayed) != 2 {
		t.Fatalf("replayed events = %#v, want two session events", replayed)
	}
	if replayed[0].SessionID != "session-1" || replayed[0].Type != "agent.document.edit.completed" {
		t.Fatalf("first replayed event = %#v, want session document edit", replayed[0])
	}
}
