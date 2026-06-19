package documenthistory

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServiceRecordsChangedDocumentIDsInAppOwnedRepo(t *testing.T) {
	projectDir := t.TempDir()
	workDir := filepath.Join(projectDir, "work")
	service := NewService()
	baseTime := time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC)

	writeHistoryTestDocument(t, workDir, "props.md", "doc-prop", "Props", "first")
	if err := os.WriteFile(filepath.Join(workDir, "poster.png"), []byte("asset"), 0o644); err != nil {
		t.Fatalf("writing non-document asset: %v", err)
	}
	firstHash, err := service.CommitProjectDocuments(CommitRequest{
		ProjectID:  "project-history",
		ProjectDir: projectDir,
		WorkDir:    workDir,
		When:       baseTime,
	})
	if err != nil {
		t.Fatalf("creating first history commit: %v", err)
	}
	if firstHash == "" {
		t.Fatal("first history commit hash is empty")
	}
	assertHistoryFileMissing(t, projectDir, workDir, "poster.png")

	writeHistoryTestDocument(t, workDir, "props.md", "doc-prop", "Props", "second")
	secondHash, err := service.CommitProjectDocuments(CommitRequest{
		ProjectID:  "project-history",
		ProjectDir: projectDir,
		WorkDir:    workDir,
		When:       baseTime.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("creating update history commit: %v", err)
	}
	if secondHash == "" {
		t.Fatal("update history commit hash is empty")
	}

	if err := os.Remove(filepath.Join(workDir, "props.md")); err != nil {
		t.Fatalf("deleting test document: %v", err)
	}
	deleteHash, err := service.CommitProjectDocuments(CommitRequest{
		ProjectID:  "project-history",
		ProjectDir: projectDir,
		WorkDir:    workDir,
		When:       baseTime.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatalf("creating delete history commit: %v", err)
	}
	if deleteHash == "" {
		t.Fatal("delete history commit hash is empty")
	}

	if _, err := os.Stat(filepath.Join(workDir, ".git")); !os.IsNotExist(err) {
		t.Fatalf("work directory .git stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(HistoryRepositoryDir(projectDir)); err != nil {
		t.Fatalf("history repository should exist: %v", err)
	}

	items, err := service.ListDocumentHistory(projectDir, workDir, "doc-prop", 10)
	if err != nil {
		t.Fatalf("listing document history: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("document history length = %d, want 3: %#v", len(items), items)
	}
	for _, item := range items {
		if !containsString(item.DocumentIDs, "doc-prop") {
			t.Fatalf("history item document IDs = %#v, want doc-prop", item.DocumentIDs)
		}
		if item.ProjectID != "project-history" {
			t.Fatalf("history item project ID = %q, want project-history", item.ProjectID)
		}
		if item.Source != defaultCommitSource {
			t.Fatalf("history item source = %q, want %q", item.Source, defaultCommitSource)
		}
	}

	version, ok, err := service.GetDocumentVersion(projectDir, workDir, "doc-prop", secondHash)
	if err != nil {
		t.Fatalf("getting document version: %v", err)
	}
	if !ok {
		t.Fatal("getting document version ok = false, want true")
	}
	if version.Hash != secondHash || version.ParentHash != firstHash || version.Category != "prop" {
		t.Fatalf("version = %#v, want hash=%s parent=%s category=prop", version, secondHash, firstHash)
	}
	if !strings.Contains(version.Content, "second") || strings.Contains(version.Content, "category: prop") {
		t.Fatalf("version content = %q, want body without frontmatter", version.Content)
	}

	diff, ok, err := service.DiffDocumentVersion(projectDir, workDir, "doc-prop", secondHash, "")
	if err != nil {
		t.Fatalf("diffing document version: %v", err)
	}
	if !ok {
		t.Fatal("diff document version ok = false, want true")
	}
	if diff.From == nil || diff.From.Hash != firstHash || diff.To.Hash != secondHash {
		t.Fatalf("diff versions = %#v, want parent %s and target %s", diff, firstHash, secondHash)
	}
	if !containsDiffLine(diff.Lines, "removed", "first") || !containsDiffLine(diff.Lines, "added", "second") {
		t.Fatalf("diff lines = %#v, want removed first and added second", diff.Lines)
	}

	if _, ok, err := service.GetDocumentVersion(projectDir, workDir, "doc-prop", deleteHash); err != nil || ok {
		t.Fatalf("deleted commit version ok=%v err=%v, want missing without error", ok, err)
	}
}

func TestServiceSkipsCleanWorktree(t *testing.T) {
	projectDir := t.TempDir()
	workDir := filepath.Join(projectDir, "work")
	service := NewService()

	writeHistoryTestDocument(t, workDir, "scene.md", "doc-scene", "Scene", "first")
	if hash, err := service.CommitProjectDocuments(CommitRequest{
		ProjectID:  "project-clean",
		ProjectDir: projectDir,
		WorkDir:    workDir,
	}); err != nil || hash == "" {
		t.Fatalf("creating first history commit hash=%q err=%v", hash, err)
	}
	hash, err := service.CommitProjectDocuments(CommitRequest{
		ProjectID:  "project-clean",
		ProjectDir: projectDir,
		WorkDir:    workDir,
	})
	if err != nil {
		t.Fatalf("committing clean worktree: %v", err)
	}
	if hash != "" {
		t.Fatalf("clean worktree commit hash = %q, want empty", hash)
	}
}

func writeHistoryTestDocument(t *testing.T, workDir string, name string, id string, title string, body string) {
	t.Helper()
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("creating test work dir: %v", err)
	}
	content := strings.Join([]string{
		"---",
		"id: " + id,
		"title: " + title,
		"category: prop",
		"---",
		"# " + title,
		"",
		body,
	}, "\n")
	if err := os.WriteFile(filepath.Join(workDir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("writing test document: %v", err)
	}
}

func assertHistoryFileMissing(t *testing.T, projectDir string, workDir string, path string) {
	t.Helper()
	repo, err := openOrInitRepository(projectDir, workDir)
	if err != nil {
		t.Fatalf("opening history repository: %v", err)
	}
	ref, err := repo.Head()
	if err != nil {
		t.Fatalf("reading history head: %v", err)
	}
	commit, err := repo.CommitObject(ref.Hash())
	if err != nil {
		t.Fatalf("reading history commit: %v", err)
	}
	if _, err := commit.File(path); err == nil {
		t.Fatalf("history contains %s, want missing", path)
	}
}

func containsDiffLine(lines []DiffLine, lineType string, text string) bool {
	for _, line := range lines {
		if line.Type == lineType && strings.Contains(line.Text, text) {
			return true
		}
	}
	return false
}
