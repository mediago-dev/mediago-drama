package events_test

import (
	"testing"

	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
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

func TestBrokerPersistsSequencedDeltaForReplay(t *testing.T) {
	store := appworkspace.NewStateService(t.TempDir())
	if store.InitErr() != nil {
		t.Fatalf("initializing workspace store: %v", store.InitErr())
	}
	projectID := "project-delta-replay"
	if _, err := store.CreateProject(projectID, servicemodel.CreateWorkspaceProjectRequest{Name: "Delta Replay"}); err != nil {
		t.Fatalf("creating project: %v", err)
	}
	broker := appevents.NewBroker(store.AppendAgentEvent)
	live, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	base := serviceagent.AgentEvent{
		SessionID: "session-1",
		ProjectID: projectID,
		RunID:     "run-1",
		TurnID:    "run-1",
		ItemID:    "message-1",
	}
	delta := base
	delta.ID = "event-delta"
	delta.Type = "agent.message.delta"
	delta.Delta = "处理"
	delta.Phase = serviceagent.AgentMessagePhaseCommentary
	broker.Publish(delta)
	firstLive := <-live
	if firstLive.Sequence != 1 {
		t.Fatalf("live delta sequence = %d, want 1", firstLive.Sequence)
	}

	inFlightReplay, err := store.LoadAgentEvents(projectID, "session-1", 0, 10)
	if err != nil {
		t.Fatalf("loading in-flight replay: %v", err)
	}
	if len(inFlightReplay) != 1 || inFlightReplay[0].Sequence != 1 {
		t.Fatalf("in-flight replay = %#v, want flushed delta sequence 1", inFlightReplay)
	}

	completed := base
	completed.ID = "event-completed"
	completed.Type = "agent.message.completed"
	completed.Content = "处理完成"
	completed.Phase = serviceagent.AgentMessagePhaseFinalAnswer
	broker.Publish(completed)
	secondLive := <-live
	if secondLive.Sequence != 2 {
		t.Fatalf("live completed sequence = %d, want 2", secondLive.Sequence)
	}

	replayed, err := store.LoadAgentEvents(projectID, "session-1", 1, 10)
	if err != nil {
		t.Fatalf("loading replayed events: %v", err)
	}
	if len(replayed) != 1 || replayed[0].Sequence != 2 {
		t.Fatalf("replayed = %#v, want completed event after delta cursor", replayed)
	}
	if inFlightReplay[0].ItemID != "message-1" || inFlightReplay[0].Phase != serviceagent.AgentMessagePhaseCommentary {
		t.Fatalf("replayed delta semantics = %#v, want persisted item identity", inFlightReplay[0])
	}
}
