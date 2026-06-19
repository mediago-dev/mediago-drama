package document

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectTrashMoveAndRestoreDirectory(t *testing.T) {
	workspaceDir := t.TempDir()
	projectDir := filepath.Join(workspaceDir, "My Project")
	if err := os.MkdirAll(filepath.Join(projectDir, "work"), 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "work", "doc.md"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("writing doc: %v", err)
	}

	trashDir, err := moveProjectDirToTrash(workspaceDir, projectDir, "project-one", "My Project", "2026-06-17T00:00:00Z")
	if err != nil {
		t.Fatalf("moveProjectDirToTrash() error = %v", err)
	}
	if _, err := os.Stat(projectDir); !os.IsNotExist(err) {
		t.Fatalf("original project dir still exists, err=%v", err)
	}
	if !strings.Contains(trashDir, filepath.Join(".mediago-drama", "trash", "projects")) {
		t.Fatalf("trashDir = %q, want global project trash path", trashDir)
	}
	if got, err := os.ReadFile(filepath.Join(trashDir, "work", "doc.md")); err != nil || string(got) != "hello" {
		t.Fatalf("trashed doc = %q err=%v, want hello", got, err)
	}

	restoredDir, err := restoreProjectDirFromTrash(trashDir, projectDir, "2026-06-17T00:01:00Z")
	if err != nil {
		t.Fatalf("restoreProjectDirFromTrash() error = %v", err)
	}
	if restoredDir != projectDir {
		t.Fatalf("restoredDir = %q, want original %q", restoredDir, projectDir)
	}
	if got, err := os.ReadFile(filepath.Join(projectDir, "work", "doc.md")); err != nil || string(got) != "hello" {
		t.Fatalf("restored doc = %q err=%v, want hello", got, err)
	}
}

func TestProjectTrashRestoreUsesUniquePathWhenOriginalExists(t *testing.T) {
	workspaceDir := t.TempDir()
	originalDir := filepath.Join(workspaceDir, "My Project")
	trashDir := filepath.Join(workspaceDir, ".mediago-drama", "trash", "projects", "trashed")
	if err := os.MkdirAll(trashDir, 0o755); err != nil {
		t.Fatalf("creating trash dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(trashDir, "doc.md"), []byte("trash"), 0o644); err != nil {
		t.Fatalf("writing trash doc: %v", err)
	}
	if err := os.MkdirAll(originalDir, 0o755); err != nil {
		t.Fatalf("creating original collision: %v", err)
	}

	restoredDir, err := restoreProjectDirFromTrash(trashDir, originalDir, "2026-06-17T00:01:02Z")
	if err != nil {
		t.Fatalf("restoreProjectDirFromTrash() error = %v", err)
	}
	if restoredDir == originalDir || !strings.Contains(filepath.Base(restoredDir), "restored-20260617T000102Z") {
		t.Fatalf("restoredDir = %q, want unique restored path", restoredDir)
	}
	if got, err := os.ReadFile(filepath.Join(restoredDir, "doc.md")); err != nil || string(got) != "trash" {
		t.Fatalf("restored doc = %q err=%v, want trash", got, err)
	}
}

func TestProjectTrashMoveFallsBackToCopyDelete(t *testing.T) {
	workspaceDir := t.TempDir()
	projectDir := filepath.Join(workspaceDir, "Copy Project")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "doc.md"), []byte("copy"), 0o644); err != nil {
		t.Fatalf("writing doc: %v", err)
	}
	originalRename := renameDirectory
	renameDirectory = func(_, _ string) error {
		return errors.New("cross-device link")
	}
	defer func() { renameDirectory = originalRename }()

	trashDir, err := moveProjectDirToTrash(workspaceDir, projectDir, "project-copy", "Copy Project", "2026-06-17T00:00:00Z")
	if err != nil {
		t.Fatalf("moveProjectDirToTrash() error = %v", err)
	}
	if _, err := os.Stat(projectDir); !os.IsNotExist(err) {
		t.Fatalf("original project dir still exists, err=%v", err)
	}
	if got, err := os.ReadFile(filepath.Join(trashDir, "doc.md")); err != nil || string(got) != "copy" {
		t.Fatalf("copied doc = %q err=%v, want copy", got, err)
	}
}
