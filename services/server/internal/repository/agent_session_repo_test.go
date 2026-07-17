package repository

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestAgentSessionRepositoryLifecycle(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewAgentSessionRepository(db)
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          "project-1",
		Name:        "Project 1",
		Category:    "agent",
		Status:      "active",
		RelativeDir: "project-1",
		CreatedAt:   domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt:   domain.TimeFromString("2026-05-22T00:00:00Z"),
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}

	session := domain.AgentSessionModel{
		SessionID:   "session-1",
		ProjectID:   "project-1",
		Title:       "整理素材清单",
		LastStatus:  "running",
		LastMessage: "Agent running",
		UpdatedAt:   domain.TimeFromString("2026-05-22T00:00:00Z"),
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

func TestAgentExecutionSessionUpsertPreservesWorkflowPointersAndRootLease(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	seedRepositoryProject(t, db, "project-session-ledger")
	repo := NewAgentSessionRepository(db)
	active := "workflow-active"
	pendingFinal := "delivery-pending"
	runID := "run-root"
	owner := "runner-a"
	leaseUntil := domain.TimeFromString("2026-07-17T03:00:00Z")
	if err := repo.UpsertAgentSession(domain.AgentSessionModel{
		SessionID: "session-ledger", ProjectID: "project-session-ledger", Title: "before",
		ActiveWorkflowID: &active, PendingFinalDeliveryID: &pendingFinal, Revision: 4,
		RootRunID: &runID, RootRunLeaseOwner: &owner, RootRunLeaseUntil: &leaseUntil, RootRunLeaseToken: 8,
	}); err != nil {
		t.Fatalf("initial UpsertAgentSession() error = %v", err)
	}
	if err := repo.UpsertAgentSession(domain.AgentSessionModel{
		SessionID: "session-ledger", ProjectID: "project-session-ledger", Title: "after", LastStatus: "running",
	}); err != nil {
		t.Fatalf("status UpsertAgentSession() error = %v", err)
	}
	got, err := repo.GetAgentSession("session-ledger")
	if err != nil {
		t.Fatalf("GetAgentSession() error = %v", err)
	}
	if got.Title != "after" || domain.StringValue(got.ActiveWorkflowID) != active || domain.StringValue(got.PendingFinalDeliveryID) != pendingFinal || got.Revision != 4 || domain.StringValue(got.RootRunID) != runID || domain.StringValue(got.RootRunLeaseOwner) != owner || got.RootRunLeaseToken != 8 {
		t.Fatalf("session after ordinary upsert = %#v", got)
	}
	claimed, ok, err := repo.ClaimRootRunLease(context.Background(), "project-session-ledger", got.SessionID, "run-next", "runner-b", leaseUntil.Add(time.Second), leaseUntil.Add(time.Minute))
	if err != nil || !ok || claimed.RootRunLeaseToken != 9 || domain.StringValue(claimed.RootRunLeaseOwner) != "runner-b" {
		t.Fatalf("ClaimRootRunLease() = %#v, %v, error=%v", claimed, ok, err)
	}
	if ok, err := repo.ReleaseRootRunLease(context.Background(), "project-session-ledger", got.SessionID, "runner-a", 8); err != nil || ok {
		t.Fatalf("stale ReleaseRootRunLease() = %v, error=%v", ok, err)
	}
	if ok, err := repo.ReleaseRootRunLease(context.Background(), "project-session-ledger", got.SessionID, "", 0); !errors.Is(err, ErrAgentInvalidCAS) || ok {
		t.Fatalf("invalid ReleaseRootRunLease() = %v, error=%v", ok, err)
	}
	if ok, err := repo.ReleaseRootRunLease(context.Background(), "project-session-ledger", got.SessionID, "runner-b", 9); err != nil || !ok {
		t.Fatalf("ReleaseRootRunLease() = %v, error=%v", ok, err)
	}
}

func TestAgentExecutionSessionUpsertRejectsCrossProjectMove(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	seedRepositoryProject(t, db, "project-session-a")
	seedRepositoryProject(t, db, "project-session-b")
	repo := NewAgentSessionRepository(db)
	if err := repo.UpsertAgentSession(domain.AgentSessionModel{SessionID: "session-scoped", ProjectID: "project-session-a", Title: "original"}); err != nil {
		t.Fatalf("initial UpsertAgentSession() error = %v", err)
	}
	if err := repo.UpsertAgentSession(domain.AgentSessionModel{SessionID: "session-scoped", ProjectID: "project-session-b", Title: "moved"}); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("cross-project UpsertAgentSession() error = %v, want ErrAgentCommandConflict", err)
	}
	got, err := repo.GetAgentSession("session-scoped")
	if err != nil || got.ProjectID != "project-session-a" || got.Title != "original" {
		t.Fatalf("session after rejected move = %#v, error=%v", got, err)
	}
}
