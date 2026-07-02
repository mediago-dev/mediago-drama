package document

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func writeWorkFile(t *testing.T, projectDir string, name string, content string) {
	t.Helper()
	target := filepath.Join(projectDir, "work", name)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("creating work dir for %s: %v", name, err)
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		t.Fatalf("writing %s: %v", name, err)
	}
}

func docIDByFilename(t *testing.T, store *Service, projectID string, filename string) string {
	t.Helper()
	response, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	for _, document := range response.Documents {
		if document.Filename == filename {
			return document.ID
		}
	}
	t.Fatalf("document for %s not found", filename)
	return ""
}

func TestSyncLocalMarkdownFilesDelta(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "delta-project"
	projectDir := requireTestProject(t, store, projectID)

	writeWorkFile(t, projectDir, "alpha.md", "# Alpha\n\nfirst")
	writeWorkFile(t, projectDir, "beta.md", "# Beta\n\nfirst")

	first, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if !first.FullReload {
		t.Fatalf("expected first sync to request a full reload, got %+v", first)
	}

	alphaID := docIDByFilename(t, store, projectID, "alpha.md")
	betaID := docIDByFilename(t, store, projectID, "beta.md")

	noop, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("no-op sync: %v", err)
	}
	if noop.FullReload || noop.StructureChanged ||
		len(noop.ChangedDocumentIDs) != 0 || len(noop.RemovedDocumentIDs) != 0 {
		t.Fatalf("expected empty delta on no-op sync, got %+v", noop)
	}

	// Change alpha only. The new content has a different length so the size-based
	// cache invalidation reliably picks it up regardless of mtime resolution.
	writeWorkFile(t, projectDir, "alpha.md", "# Alpha\n\nsecond revision is clearly longer")
	changed, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("changed sync: %v", err)
	}
	if changed.FullReload {
		t.Fatalf("did not expect a full reload, got %+v", changed)
	}
	if !equalStringSlices(changed.ChangedDocumentIDs, []string{alphaID}) {
		t.Fatalf("expected only alpha changed, got %+v (alpha=%s beta=%s)", changed.ChangedDocumentIDs, alphaID, betaID)
	}
	if len(changed.RemovedDocumentIDs) != 0 || changed.StructureChanged {
		t.Fatalf("content-only change should not be structural, got %+v", changed)
	}

	// Remove beta. It is reported as removed; the folder tree did not change so
	// StructureChanged stays false (removal is conveyed via RemovedDocumentIDs).
	if err := os.Remove(filepath.Join(projectDir, "work", "beta.md")); err != nil {
		t.Fatalf("removing beta: %v", err)
	}
	removed, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("removed sync: %v", err)
	}
	if !equalStringSlices(removed.RemovedDocumentIDs, []string{betaID}) {
		t.Fatalf("expected beta removed, got %+v", removed.RemovedDocumentIDs)
	}
	if removed.StructureChanged {
		t.Fatalf("root-file removal should not be structural, got %+v", removed)
	}
	if len(removed.ChangedDocumentIDs) != 0 {
		t.Fatalf("did not expect changed ids on pure removal, got %+v", removed.ChangedDocumentIDs)
	}

	// Add a document inside a new subfolder. The folder tree changes, so
	// StructureChanged is set and the new document is reported as changed.
	writeWorkFile(t, projectDir, filepath.Join("chapter-1", "gamma.md"), "# Gamma")
	structural, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("structural sync: %v", err)
	}
	if !structural.StructureChanged {
		t.Fatalf("expected structure change when a folder appears, got %+v", structural)
	}
	gammaID := docIDByFilename(t, store, projectID, filepath.ToSlash(filepath.Join("chapter-1", "gamma.md")))
	if !equalStringSlices(structural.ChangedDocumentIDs, []string{gammaID}) {
		t.Fatalf("expected only gamma changed, got %+v", structural.ChangedDocumentIDs)
	}
}

func TestSyncLocalMarkdownFilesIgnoresAPISaveEcho(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "api-save-echo-project"
	projectDir := requireTestProject(t, store, projectID)

	writeWorkFile(t, projectDir, "alpha.md", "# Alpha\n\nfirst")
	if first, err := store.SyncLocalMarkdownFiles(projectID); err != nil {
		t.Fatalf("first sync: %v", err)
	} else if !first.FullReload {
		t.Fatalf("expected first sync to request a full reload, got %+v", first)
	}

	alphaID := docIDByFilename(t, store, projectID, "alpha.md")
	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	alpha := findTestWorkspaceDocument(state.Documents, alphaID)
	nextContent := "# Alpha\n\nsaved through the API with a longer body"
	_, _, err = store.UpdateWorkspaceDocument(projectID, alphaID, updateWorkspaceDocumentRequest{
		Content:         &nextContent,
		ExpectedVersion: &alpha.Version,
	})
	if err != nil {
		t.Fatalf("updating document through API: %v", err)
	}

	echo, err := store.SyncLocalMarkdownFiles(projectID)
	if err != nil {
		t.Fatalf("sync after API save: %v", err)
	}
	if echo.FullReload || echo.StructureChanged ||
		len(echo.ChangedDocumentIDs) != 0 || len(echo.RemovedDocumentIDs) != 0 {
		t.Fatalf("expected API save echo to be suppressed, got %+v", echo)
	}
}

func TestListWorkspaceDocumentsByIDs(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "ids-project"
	projectDir := requireTestProject(t, store, projectID)

	writeWorkFile(t, projectDir, "alpha.md", "# Alpha")
	writeWorkFile(t, projectDir, "beta.md", "# Beta")

	alphaID := docIDByFilename(t, store, projectID, "alpha.md")

	scoped, err := store.ListWorkspaceDocumentsByIDs(projectID, []string{alphaID, "missing-id"})
	if err != nil {
		t.Fatalf("listing by ids: %v", err)
	}
	if len(scoped.Documents) != 1 || scoped.Documents[0].ID != alphaID {
		t.Fatalf("expected only alpha, got %+v", scoped.Documents)
	}

	empty, err := store.ListWorkspaceDocumentsByIDs(projectID, nil)
	if err != nil {
		t.Fatalf("listing by empty ids: %v", err)
	}
	if len(empty.Documents) != 0 {
		t.Fatalf("expected no documents for empty ids, got %d", len(empty.Documents))
	}
}

func equalStringSlices(actual []string, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	a := append([]string(nil), actual...)
	b := append([]string(nil), expected...)
	sort.Strings(a)
	sort.Strings(b)
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
