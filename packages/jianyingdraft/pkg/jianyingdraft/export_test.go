package jianyingdraft

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestExportWritesDraftFilesAndHonorsReplaceExisting(t *testing.T) {
	dir := t.TempDir()
	video := writeTestFile(t, dir, "video.mp4")
	second := writeTestFile(t, dir, "second.mp4")
	draft := testDraftWithShots(t, video, second)
	root := filepath.Join(dir, "JianyingPro Drafts")

	result, err := draft.ExportContext(nil, root, ExportOptions{})
	if err != nil {
		t.Fatalf("ExportContext() error = %v", err)
	}
	if result.ShotCount != 2 || result.DurationMicros != 8_000_000 {
		t.Fatalf("result = %#v, want shot count and duration", result)
	}
	if _, err := os.Stat(filepath.Join(result.DraftPath, "draft_content.json")); err != nil {
		t.Fatalf("draft_content.json missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(result.DraftPath, "draft_meta_info.json")); err != nil {
		t.Fatalf("draft_meta_info.json missing: %v", err)
	}
	rawMeta, err := os.ReadFile(result.MetaPath)
	if err != nil {
		t.Fatalf("read meta: %v", err)
	}
	var meta map[string]any
	if err := json.Unmarshal(rawMeta, &meta); err != nil {
		t.Fatalf("unmarshal meta: %v", err)
	}
	if got := meta["draft_new_version"]; got != "" {
		t.Fatalf("draft_new_version = %#v, want pyJianYingDraft template value", got)
	}
	for _, key := range []string{"draft_fold_path", "draft_name", "draft_root_path"} {
		if got := meta[key]; got != "" {
			t.Fatalf("%s = %#v, want pyJianYingDraft template value", key, got)
		}
	}
	if got := meta["tm_duration"]; got != float64(0) {
		t.Fatalf("tm_duration = %#v, want pyJianYingDraft template value", got)
	}
	if _, ok := meta["tm_draft_modified"]; ok {
		t.Fatal("tm_draft_modified is present, want pyJianYingDraft template shape")
	}

	_, err = draft.ExportContext(nil, root, ExportOptions{})
	if !errors.Is(err, ErrDraftAlreadyExists) {
		t.Fatalf("ExportContext() error = %v, want ErrDraftAlreadyExists", err)
	}

	if _, err := draft.ExportContext(nil, root, ExportOptions{ReplaceExisting: true}); err != nil {
		t.Fatalf("ExportContext(replace) error = %v", err)
	}
}

func TestExportCopiesMediaWhenRequested(t *testing.T) {
	dir := t.TempDir()
	video := writeTestFile(t, dir, "video.mp4")
	draft := NewDraft(DraftOptions{
		Name:   "copy-media",
		Width:  1920,
		Height: 1080,
		FPS:    30,
		MetadataReader: fakeMetadataReader{metadata: map[string]VideoMetadata{
			video: {Duration: 5_000_000, Width: 1920, Height: 1080},
		}},
	})
	if err := draft.AddShots([]Shot{{Path: video}}); err != nil {
		t.Fatalf("AddShots() error = %v", err)
	}

	result, err := draft.ExportContext(nil, filepath.Join(dir, "drafts"), ExportOptions{CopyMedia: true})
	if err != nil {
		t.Fatalf("ExportContext() error = %v", err)
	}
	copiedPath := filepath.Join(result.DraftPath, "materials", "video.mp4")
	if _, err := os.Stat(copiedPath); err != nil {
		t.Fatalf("copied media missing: %v", err)
	}

	raw, err := os.ReadFile(result.ContentPath)
	if err != nil {
		t.Fatalf("read content: %v", err)
	}
	var content contentTestDocument
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if got := content.Materials.Videos[0].Path; got != copiedPath {
		t.Fatalf("material path = %q, want copied path %q", got, copiedPath)
	}
}
