package agent

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
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
	if status.Running || status.LastStatus != "cancelled" {
		t.Fatalf("Cancel status = %+v, want cancelled and not running", status)
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

func newTestAgentSessionRepository(t *testing.T) *repository.AgentSessionRepository {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("opening workspace database: %v", err)
	}
	return repository.NewAgentSessionRepository(db)
}
