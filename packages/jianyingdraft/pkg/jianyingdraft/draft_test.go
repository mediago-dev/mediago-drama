package jianyingdraft

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeMetadataReader struct {
	metadata map[string]VideoMetadata
}

func (reader fakeMetadataReader) Probe(_ context.Context, path string) (VideoMetadata, error) {
	if metadata, ok := reader.metadata[path]; ok {
		return metadata, nil
	}
	return VideoMetadata{}, errors.New("unexpected path")
}

func TestAddShotsNormalizesAndValidatesShots(t *testing.T) {
	dir := t.TempDir()
	first := writeTestFile(t, dir, "first.mp4")
	second := writeTestFile(t, dir, "second.mp4")
	draft := NewDraft(DraftOptions{
		Name:   "storyboard",
		Width:  1920,
		Height: 1080,
		FPS:    30,
		MetadataReader: fakeMetadataReader{metadata: map[string]VideoMetadata{
			first:  {Duration: 5_000_000, Width: 1920, Height: 1080},
			second: {Duration: 8_000_000, Width: 1280, Height: 720},
		}},
	})

	if err := draft.AddShots([]Shot{
		{Path: first},
		{Path: second, In: 2_000_000, Duration: 3_000_000},
	}); err != nil {
		t.Fatalf("AddShots() error = %v", err)
	}

	if len(draft.shots) != 2 {
		t.Fatalf("shots len = %d, want 2", len(draft.shots))
	}
	if got := draft.shots[0].duration; got != 5_000_000 {
		t.Fatalf("first duration = %d, want default remaining duration", got)
	}
	if got := draft.shots[1].in; got != 2_000_000 {
		t.Fatalf("second in = %d, want trim in", got)
	}
	if !filepath.IsAbs(draft.shots[0].path) {
		t.Fatalf("shot path = %q, want absolute path", draft.shots[0].path)
	}
}

func TestAddShotsRejectsInvalidInputsWithoutPartialAppend(t *testing.T) {
	dir := t.TempDir()
	video := writeTestFile(t, dir, "video.mp4")
	draft := NewDraft(DraftOptions{
		Name:   "storyboard",
		Width:  1920,
		Height: 1080,
		FPS:    30,
		MetadataReader: fakeMetadataReader{metadata: map[string]VideoMetadata{
			video: {Duration: 5_000_000, Width: 1920, Height: 1080},
		}},
	})

	err := draft.AddShots([]Shot{
		{Path: video},
		{Path: video, In: 4_000_000, Duration: 2_000_000},
	})
	if err == nil || !strings.Contains(err.Error(), "trim range exceeds") {
		t.Fatalf("AddShots() error = %v, want trim range error", err)
	}
	if len(draft.shots) != 0 {
		t.Fatalf("shots len = %d, want no partial append", len(draft.shots))
	}
}

func TestAddShotsRejectsInvalidDraftOptions(t *testing.T) {
	draft := NewDraft(DraftOptions{Name: "", Width: 1920, Height: 1080, FPS: 30})
	if err := draft.AddShots(nil); err == nil || !strings.Contains(err.Error(), "draft name") {
		t.Fatalf("AddShots() error = %v, want draft name validation", err)
	}

	draft = NewDraft(DraftOptions{Name: "bad/name", Width: 1920, Height: 1080, FPS: 30})
	if err := draft.AddShots(nil); err == nil || !strings.Contains(err.Error(), "path separators") {
		t.Fatalf("AddShots() error = %v, want separator validation", err)
	}
}

func writeTestFile(t *testing.T, dir string, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("test video"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		t.Fatalf("abs test file: %v", err)
	}
	return absolute
}
