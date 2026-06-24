package document

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListWorkspaceDocumentsReportsOnDiskFilename(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "filename-report"
	projectDir := requireTestProject(t, store, projectID)

	workDir := filepath.Join(projectDir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("creating work dir: %v", err)
	}
	// Two same-titled files exist on disk (the kind of leftover that confused the sidebar);
	// each document must report its own real filename rather than a re-derived one.
	if err := os.WriteFile(filepath.Join(workDir, "第一集道具.md"), []byte("# 道具一\n"), 0o644); err != nil {
		t.Fatalf("writing markdown file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "第一集道具-2.md"), []byte("# 道具二\n"), 0o644); err != nil {
		t.Fatalf("writing second markdown file: %v", err)
	}

	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocuments returned error: %v", err)
	}

	filenames := map[string]bool{}
	for _, document := range state.Documents {
		filenames[document.Filename] = true
	}
	for _, want := range []string{"第一集道具.md", "第一集道具-2.md"} {
		if !filenames[want] {
			t.Fatalf("documents %+v missing on-disk filename %q", filenames, want)
		}
	}
}

func TestListWorkspaceDocumentsAssignsUniqueIDsForDuplicateFrontmatterIDs(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "duplicate-frontmatter-id"
	projectDir := requireTestProject(t, store, projectID)

	workDir := filepath.Join(projectDir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("creating work dir: %v", err)
	}

	first := "---\nid: doc-same\ntitle: 第一集道具\ncategory: prop\n---\n# 道具一\n"
	second := "---\nid: doc-same\ntitle: 第一集道具\ncategory: prop\n---\n# 道具二\n"
	if err := os.WriteFile(filepath.Join(workDir, "第一集道具.md"), []byte(first), 0o644); err != nil {
		t.Fatalf("writing first markdown file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "第一集道具-2.md"), []byte(second), 0o644); err != nil {
		t.Fatalf("writing second markdown file: %v", err)
	}

	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocuments returned error: %v", err)
	}

	idsByFilename := map[string]string{}
	for _, document := range state.Documents {
		idsByFilename[document.Filename] = document.ID
	}
	firstID := idsByFilename["第一集道具.md"]
	secondID := idsByFilename["第一集道具-2.md"]
	if firstID == "" || secondID == "" {
		t.Fatalf("idsByFilename = %+v, want both markdown files listed", idsByFilename)
	}
	if firstID == secondID {
		t.Fatalf("duplicate document ids: %s for %+v", firstID, idsByFilename)
	}
}
