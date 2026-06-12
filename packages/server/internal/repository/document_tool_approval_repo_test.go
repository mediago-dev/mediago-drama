package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
)

func TestDocumentToolApprovalRepositoryLifecycle(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewDocumentToolApprovalRepository(db)

	approval := domain.DocumentToolApprovalModel{
		ProjectID:   "project-1",
		ID:          "approval-1",
		ToolName:    "delete_document",
		DocumentID:  "doc-1",
		Status:      "pending",
		RequestJSON: `{"id":"call-1","name":"delete_document"}`,
		CreatedAt:   "2026-05-22T00:00:00Z",
	}
	if err := repo.CreateDocumentToolApproval(approval); err != nil {
		t.Fatalf("CreateDocumentToolApproval() error = %v", err)
	}

	pending, err := repo.ListPendingDocumentToolApprovals("project-1")
	if err != nil {
		t.Fatalf("ListPendingDocumentToolApprovals() error = %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("ListPendingDocumentToolApprovals() len = %d, want 1", len(pending))
	}

	updated, err := repo.DecidePendingDocumentToolApproval("project-1", "approval-1", "approved", "2026-05-22T00:01:00Z", `{"ok":true}`)
	if err != nil {
		t.Fatalf("DecidePendingDocumentToolApproval() error = %v", err)
	}
	if !updated {
		t.Fatal("DecidePendingDocumentToolApproval() updated = false, want true")
	}
	got, err := repo.GetDocumentToolApproval("project-1", "approval-1")
	if err != nil {
		t.Fatalf("GetDocumentToolApproval() error = %v", err)
	}
	if got.Status != "approved" {
		t.Fatalf("Status = %q, want approved", got.Status)
	}
	if got.DecisionPayloadJSON == "" {
		t.Fatal("DecisionPayloadJSON is empty, want payload")
	}

	updated, err = repo.DecidePendingDocumentToolApproval("project-1", "approval-1", "rejected", "2026-05-22T00:02:00Z", "")
	if err != nil {
		t.Fatalf("DecidePendingDocumentToolApproval() second decision error = %v", err)
	}
	if updated {
		t.Fatal("DecidePendingDocumentToolApproval() second updated = true, want false")
	}
	if _, err := repo.GetDocumentToolApproval("project-1", "missing"); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetDocumentToolApproval() missing error = %v, want ErrRecordNotFound", err)
	}
}
