package document

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/documenthistory"
)

func TestWorkspaceStateServiceRecordsDocumentHistory(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-document-history"
	projectDir := requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "Props",
		Content:  "# Props\n\nfirst",
		Category: "prop",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	nextContent := "# Props\n\nsecond"
	if _, _, err := store.updateDocument(projectID, document.ID, updateWorkspaceDocumentRequest{
		Content: &nextContent,
	}); err != nil {
		t.Fatalf("updating document: %v", err)
	}

	if _, err := store.deleteDocument(projectID, document.ID); err != nil {
		t.Fatalf("deleting document: %v", err)
	}

	history := documenthistory.NewService()
	items, err := history.ListDocumentHistory(projectDir, filepath.Join(projectDir, "work"), document.ID, 10)
	if err != nil {
		t.Fatalf("listing document history: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("document history length = %d, want 3: %#v", len(items), items)
	}
	if _, err := os.Stat(filepath.Join(projectDir, "work", ".git")); !os.IsNotExist(err) {
		t.Fatalf("work .git stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(documenthistory.HistoryRepositoryDir(projectDir)); err != nil {
		t.Fatalf("history repository should exist: %v", err)
	}
}
