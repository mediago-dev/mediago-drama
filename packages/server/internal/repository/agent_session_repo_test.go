package repository

import (
	"path/filepath"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

func TestAgentSessionRepositoryLifecycle(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewAgentSessionRepository(db)

	session := domain.AgentSessionModel{
		SessionID:   "session-1",
		ProjectID:   "project-1",
		Title:       "整理素材清单",
		LastStatus:  "running",
		LastMessage: "Agent running",
		UpdatedAt:   "2026-05-22T00:00:00Z",
	}
	if err := repo.UpsertAgentSession(session); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}

	got, err := repo.FindLatestAgentSessionByProject(session.ProjectID)
	if err != nil {
		t.Fatalf("FindLatestAgentSessionByProject() error = %v", err)
	}
	if got.SessionID != session.SessionID {
		t.Fatalf("SessionID = %q, want %q", got.SessionID, session.SessionID)
	}
	if got.Title != session.Title {
		t.Fatalf("Title = %q, want %q", got.Title, session.Title)
	}

	sessions, err := repo.ListAgentSessions(session.ProjectID)
	if err != nil {
		t.Fatalf("ListAgentSessions() error = %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("ListAgentSessions() len = %d, want 1", len(sessions))
	}

	if err := repo.ReconcileInterruptedRuns([]string{"running"}, "paused", "2026-05-22T00:01:00Z"); err != nil {
		t.Fatalf("ReconcileInterruptedRuns() error = %v", err)
	}
	got, err = repo.GetAgentSession(session.SessionID)
	if err != nil {
		t.Fatalf("GetAgentSession() error = %v", err)
	}
	if got.LastStatus != "paused" {
		t.Fatalf("session LastStatus = %q, want paused", got.LastStatus)
	}
}
