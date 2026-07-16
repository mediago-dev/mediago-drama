package agent

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestSessionServiceRunsOneAgentAtATime(t *testing.T) {
	store := NewSessionService(nil)
	store.create("session-1", "project-1")

	if _, ok := store.StartRun("session-1", "project-1", "run-1", func() {}, AgentRunStartOptions{
		AgentTag: "MediaGo Drama Agent",
	}); !ok {
		t.Fatal("starting run failed")
	}
	if _, ok := store.StartRun("session-1", "project-1", "run-2", func() {}, AgentRunStartOptions{}); ok {
		t.Fatal("starting a concurrent run should fail")
	}

	result := store.FinishRun("session-1", "run-1", "completed", "done")
	if !result.Terminal || result.Status.LastStatus != "completed" || result.Status.Running {
		t.Fatalf("finish result = %+v, want completed terminal run", result)
	}

	if _, ok := store.StartRun("session-1", "project-1", "run-2", func() {}, AgentRunStartOptions{}); !ok {
		t.Fatal("starting a new run after completion should be allowed")
	}
}

func TestSessionServiceCancelActiveRun(t *testing.T) {
	store := NewSessionService(nil)
	store.create("session-1", "project-1")
	cancelled := false

	if _, ok := store.StartRun("session-1", "project-1", "run-1", func() {
		cancelled = true
	}, AgentRunStartOptions{}); !ok {
		t.Fatal("starting run failed")
	}

	status, ok := store.cancelRun("session-1")
	if !ok {
		t.Fatal("Cancel should report an active run")
	}
	if !cancelled {
		t.Fatal("Cancel should call the active run cancel function")
	}
	if status.Running || status.LastStatus != "cancelled" || status.ProjectID != "project-1" || status.RunID != "run-1" {
		t.Fatalf("Cancel status = %+v, want cancelled project/run metadata and not running", status)
	}
}

func TestSessionServiceRunStatusGuardSerializesCancellation(t *testing.T) {
	store := NewSessionService(nil)
	store.create("session-1", "project-1")
	if _, ok := store.StartRun("session-1", "project-1", "run-1", func() {}, AgentRunStartOptions{}); !ok {
		t.Fatal("starting run failed")
	}

	guardEntered := make(chan struct{})
	releaseGuard := make(chan struct{})
	guardDone := make(chan error, 1)
	go func() {
		guardDone <- store.WithRunStatus("session-1", "run-1", func(status string, found bool) error {
			if !found || status != "running" {
				t.Errorf("WithRunStatus() = %q, found=%v; want running", status, found)
			}
			close(guardEntered)
			<-releaseGuard
			return nil
		})
	}()
	<-guardEntered

	cancelDone := make(chan bool, 1)
	go func() {
		_, cancelled := store.CancelRun("session-1")
		cancelDone <- cancelled
	}()
	select {
	case <-cancelDone:
		t.Fatal("CancelRun() completed while guarded decision was still in progress")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseGuard)
	if err := <-guardDone; err != nil {
		t.Fatalf("WithRunStatus() error = %v", err)
	}
	if cancelled := <-cancelDone; !cancelled {
		t.Fatal("CancelRun() did not cancel after guard released")
	}

	if err := store.WithRunStatus("session-1", "run-1", func(status string, found bool) error {
		if !found || status != "cancelled" {
			t.Fatalf("WithRunStatus() after cancel = %q, found=%v; want cancelled", status, found)
		}
		return nil
	}); err != nil {
		t.Fatalf("WithRunStatus() after cancel error = %v", err)
	}
}

func TestSessionServiceRepositoryReadsPreserveActiveRun(t *testing.T) {
	tests := []struct {
		name string
		read func(t *testing.T, store *SessionService)
	}{
		{
			name: "list sessions",
			read: func(t *testing.T, store *SessionService) {
				t.Helper()
				summaries := store.List("project-1")
				if len(summaries) != 1 || summaries[0].SessionID != "session-1" {
					t.Fatalf("List() = %#v, want session-1", summaries)
				}
			},
		},
		{
			name: "resolve latest project session",
			read: func(t *testing.T, store *SessionService) {
				t.Helper()
				sessionID, ok := store.ProjectSessionID("project-1")
				if !ok || sessionID != "session-1" {
					t.Fatalf("ProjectSessionID() = %q, %v; want session-1, true", sessionID, ok)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := NewSessionService(newTestAgentSessionRepository(t))
			store.create("session-1", "project-1")
			if _, ok := store.StartRun(
				"session-1",
				"project-1",
				"run-1",
				func() {},
				AgentRunStartOptions{},
			); !ok {
				t.Fatal("starting run failed")
			}

			tt.read(t, store)

			if err := store.WithRunStatus("session-1", "run-1", func(status string, found bool) error {
				if !found || status != "running" {
					t.Fatalf("WithRunStatus() after repository read = %q, found=%v; want running", status, found)
				}
				return nil
			}); err != nil {
				t.Fatalf("WithRunStatus() error = %v", err)
			}
		})
	}
}

func TestSessionServicePersistsAndReconcilesInterruptedRuns(t *testing.T) {
	repo := newTestAgentSessionRepository(t)

	store := NewSessionService(repo)
	store.create("session-1", "project-1")
	if _, ok := store.StartRun("session-1", "project-1", "run-1", func() {}, AgentRunStartOptions{
		AgentTag: "MediaGo Drama Agent",
	}); !ok {
		t.Fatal("starting run failed")
	}

	restarted := NewSessionService(repo)
	status := restarted.Status("session-1")
	if status.Running || status.LastStatus != "paused" {
		t.Fatalf("status after reconcile = %+v, want paused and not running", status)
	}

	if _, ok := restarted.Run("session-1", "run-1"); ok {
		t.Fatal("run state should not be persisted separately from session state")
	}
}

func TestSessionServicePersistsGeneratedTitle(t *testing.T) {
	repo := newTestAgentSessionRepository(t)
	store := NewSessionService(repo)
	store.create("session-1", "project-1")

	if !store.NeedsTitle("session-1") {
		t.Fatal("new session should need a title")
	}
	if !store.SetTitleIfEmpty("session-1", "整理素材清单") {
		t.Fatal("SetTitleIfEmpty should store the first title")
	}
	if store.NeedsTitle("session-1") {
		t.Fatal("titled session should not need a title")
	}
	if store.SetTitleIfEmpty("session-1", "第二个标题") {
		t.Fatal("SetTitleIfEmpty should not overwrite an existing title")
	}

	summaries := store.List("project-1")
	if len(summaries) != 1 || summaries[0].Title != "整理素材清单" {
		t.Fatalf("summaries = %#v, want persisted title", summaries)
	}

	restarted := NewSessionService(repo)
	summaries = restarted.List("project-1")
	if len(summaries) != 1 || summaries[0].Title != "整理素材清单" {
		t.Fatalf("restarted summaries = %#v, want persisted title", summaries)
	}
}

func TestSessionServicePersistsAndClearsACPInstructionState(t *testing.T) {
	repo := newTestAgentSessionRepository(t)
	store := NewSessionService(repo)
	store.create("session-1", "project-1")

	initial, ok := store.StartRun("session-1", "project-1", "run-1", func() {}, AgentRunStartOptions{})
	if !ok {
		t.Fatal("starting first run failed")
	}
	if initial.SessionID != "" || initial.InstructionHash != "" {
		t.Fatalf("initial ACP state = %#v, want empty", initial)
	}

	want := ACPSessionState{
		SessionID:       "acp-session-1",
		InstructionHash: "instruction-v1:abc123",
	}
	store.SetACPSessionState("session-1", "run-1", want)
	run, ok := store.Run("session-1", "run-1")
	if !ok || run.ACPSessionID != want.SessionID || run.ACPInstructionHash != want.InstructionHash {
		t.Fatalf("run ACP state = %#v, want %#v", run, want)
	}
	store.FinishRun("session-1", "run-1", "completed", "done")

	restarted := NewSessionService(repo)
	loaded, ok := restarted.StartRun("session-1", "project-1", "run-2", func() {}, AgentRunStartOptions{})
	if !ok || loaded != want {
		t.Fatalf("loaded ACP state = %#v, ok=%v; want %#v", loaded, ok, want)
	}
	restarted.FinishRun("session-1", "run-2", "completed", "done")
	restarted.ClearACPSessionID("session-1")

	cleared, ok := restarted.StartRun("session-1", "project-1", "run-3", func() {}, AgentRunStartOptions{})
	if !ok {
		t.Fatal("starting run after clear failed")
	}
	if cleared.SessionID != "" || cleared.InstructionHash != "" {
		t.Fatalf("cleared ACP state = %#v, want empty", cleared)
	}
}

func newTestAgentSessionRepository(t *testing.T) *repository.AgentSessionRepository {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("opening workspace database: %v", err)
	}
	now := domain.TimeFromString("2026-06-01T00:00:00Z")
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          "project-1",
		Name:        "Project 1",
		Category:    "agent",
		Status:      "active",
		RelativeDir: "project-1",
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}
	return repository.NewAgentSessionRepository(db)
}
