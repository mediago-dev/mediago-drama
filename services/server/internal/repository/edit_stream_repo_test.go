package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestDocumentEditStreamRepositoryUpsertAndGet(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewDocumentEditStreamRepository(db)
	seedRepositoryProject(t, db, "project-1")

	if _, err := repo.GetDocumentEditStream("project-1", "stream-1"); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetDocumentEditStream() missing error = %v, want ErrRecordNotFound", err)
	}

	record := domain.DocumentEditStreamModel{
		ProjectID:   "project-1",
		StreamID:    "stream-1",
		DocumentID:  "doc-1",
		Mode:        "replace_block",
		AnchorText:  "draft",
		BaseVersion: 3,
		Buffer:      "updated text",
		Status:      "streaming",
		BeforeJSON:  `{"content":"draft"}`,
		CreatedAt:   domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt:   domain.TimeFromString("2026-05-22T00:00:00Z"),
	}
	if err := repo.UpsertDocumentEditStream(record); err != nil {
		t.Fatalf("UpsertDocumentEditStream() error = %v", err)
	}

	record.Status = "completed"
	record.UpdatedAt = domain.TimeFromString("2026-05-22T00:01:00Z")
	if err := repo.UpsertDocumentEditStream(record); err != nil {
		t.Fatalf("UpsertDocumentEditStream() update error = %v", err)
	}

	got, err := repo.GetDocumentEditStream("project-1", "stream-1")
	if err != nil {
		t.Fatalf("GetDocumentEditStream() error = %v", err)
	}
	if got.Status != "completed" {
		t.Fatalf("Status = %q, want completed", got.Status)
	}
	if got.Buffer != record.Buffer {
		t.Fatalf("Buffer = %q, want %q", got.Buffer, record.Buffer)
	}
}
