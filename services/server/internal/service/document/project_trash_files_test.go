package document

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
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

func TestMoveDirectorySerializesConcurrentProjectMoves(t *testing.T) {
	root := t.TempDir()
	originalRename := renameDirectory
	var active int32
	var maximum int32
	renameDirectory = func(source, target string) error {
		current := atomic.AddInt32(&active, 1)
		for {
			seen := atomic.LoadInt32(&maximum)
			if current <= seen || atomic.CompareAndSwapInt32(&maximum, seen, current) {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
		atomic.AddInt32(&active, -1)
		return originalRename(source, target)
	}
	defer func() { renameDirectory = originalRename }()

	var group sync.WaitGroup
	errors := make(chan error, 7)
	for index := 0; index < 7; index++ {
		source := filepath.Join(root, fmt.Sprintf("source-%d", index))
		target := filepath.Join(root, fmt.Sprintf("target-%d", index))
		if err := os.MkdirAll(source, 0o755); err != nil {
			t.Fatal(err)
		}
		group.Add(1)
		go func() {
			defer group.Done()
			errors <- moveDirectory(source, target)
		}()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent move error = %v", err)
		}
	}
	if got := atomic.LoadInt32(&maximum); got != 1 {
		t.Fatalf("maximum concurrent directory moves = %d, want 1", got)
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

func TestProjectTrashMoveRetriesTransientWindowsLock(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows locking behavior")
	}
	workspaceDir := t.TempDir()
	projectDir := filepath.Join(workspaceDir, "Locked Project")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}

	originalRename := renameDirectory
	var attempts atomic.Int32
	renameDirectory = func(source, target string) error {
		if attempts.Add(1) < 3 {
			return &os.PathError{Op: "rename", Path: source, Err: syscall.Errno(32)}
		}
		return os.Rename(source, target)
	}
	defer func() { renameDirectory = originalRename }()

	trashDir, err := moveProjectDirToTrash(workspaceDir, projectDir, "project-locked", "Locked Project", "2026-06-17T00:00:00Z")
	if err != nil {
		t.Fatalf("moveProjectDirToTrash() error = %v", err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("rename attempts = %d, want 3", attempts.Load())
	}
	if _, err := os.Stat(trashDir); err != nil {
		t.Fatalf("trashed project dir missing: %v", err)
	}
}
