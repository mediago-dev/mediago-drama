package promptlibrary

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"testing/fstest"

	configassets "github.com/mediago-dev/mediago-drama/services/server/configs"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestStoreSeedsBuiltinPromptEntriesIntoDatabase(t *testing.T) {
	store, repo := newTestStore(t, testDefaultsFS())

	entries, err := store.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(entries) != 4 {
		t.Fatalf("entries = %#v, want four seeded entries", entries)
	}

	models, err := repo.ListPromptLibraryEntries()
	if err != nil {
		t.Fatalf("ListPromptLibraryEntries() error = %v", err)
	}
	if len(models) != 4 {
		t.Fatalf("models = %#v, want built-ins persisted to database", models)
	}

	imageConcept, err := store.Get(context.Background(), "image-concept")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if imageConcept.Source != SourceBuiltin || !imageConcept.Builtin || imageConcept.Name != "概念图" {
		t.Fatalf("imageConcept = %#v, want seeded built-in prompt", imageConcept)
	}
}

func TestStoreListFiltersPromptEntries(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	imagePrompts, err := store.List(context.Background(), Filter{Kind: "image"})
	if err != nil {
		t.Fatalf("List(kind=image) error = %v", err)
	}
	if len(imagePrompts) != 2 {
		t.Fatalf("imagePrompts = %#v, want image prompts", imagePrompts)
	}

	extraImagePrompts, err := store.List(context.Background(), Filter{Layer: layerExtra, Kind: "image"})
	if err != nil {
		t.Fatalf("List(layer=extra, kind=image) error = %v", err)
	}
	if !hasPromptEntry(extraImagePrompts, "character-multi-view") {
		t.Fatalf("extraImagePrompts = %#v, want character prompt", extraImagePrompts)
	}
}

func TestStoreUpdateBuiltinCreatesDatabaseOverrideAndResetRestoresDefault(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	updated, err := store.Update(context.Background(), "image-concept", PromptEntry{
		ID:     "image-concept",
		Name:   "自定义概念图",
		Type:   "image",
		Kind:   "image",
		Prompt: "用户覆盖。",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Source != SourceUser || !updated.Builtin || updated.Prompt != "用户覆盖。" {
		t.Fatalf("updated = %#v, want user override for builtin", updated)
	}

	if _, err := store.List(context.Background(), Filter{}); err != nil {
		t.Fatalf("List() after override error = %v", err)
	}
	stillOverridden, err := store.Get(context.Background(), "image-concept")
	if err != nil {
		t.Fatalf("Get() overridden error = %v", err)
	}
	if stillOverridden.Source != SourceUser || stillOverridden.Prompt != "用户覆盖。" {
		t.Fatalf("stillOverridden = %#v, want sync to preserve user override", stillOverridden)
	}

	reset, err := store.Reset(context.Background(), "image-concept")
	if err != nil {
		t.Fatalf("Reset() error = %v", err)
	}
	if reset.Source != SourceBuiltin || !reset.Builtin || reset.Name != "概念图" || reset.Prompt != "内置提示" {
		t.Fatalf("reset = %#v, want system default", reset)
	}
}

func TestStoreCreateUpdateAndDeleteUserPromptEntry(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	created, err := store.Create(context.Background(), PromptEntry{
		ID:     "noir-image",
		Name:   "黑色电影图像",
		Type:   "image",
		Prompt: "低调光，强反差。",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Source != SourceUser || created.Builtin || created.Kind != "image" {
		t.Fatalf("created = %#v, want user image prompt with default kind", created)
	}

	updated, err := store.Update(context.Background(), "noir-image", PromptEntry{
		ID:     "noir-image",
		Name:   "黑色电影图像",
		Type:   "image",
		Kind:   "image",
		Prompt: "雨夜，强反差。",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Prompt != "雨夜，强反差。" || updated.Builtin {
		t.Fatalf("updated = %#v, want updated user prompt", updated)
	}

	if err := store.Delete(context.Background(), "noir-image"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Get(context.Background(), "noir-image"); !errors.Is(err, ErrPromptEntryNotFound) {
		t.Fatalf("Get() error = %v, want ErrPromptEntryNotFound", err)
	}
}

func TestStoreCollapsesLegacyLayersToExtra(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	created, err := store.Create(context.Background(), PromptEntry{
		ID:     "legacy-tone",
		Name:   "旧语气层",
		Layer:  layerTone,
		Kind:   "image",
		Prompt: "保持克制语气。",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Layer != layerExtra {
		t.Fatalf("created.Layer = %q, want %q", created.Layer, layerExtra)
	}

	extraEntries, err := store.List(context.Background(), Filter{Layer: layerExtra})
	if err != nil {
		t.Fatalf("List(layer=extra) error = %v", err)
	}
	if !hasPromptEntry(extraEntries, "legacy-tone") {
		t.Fatalf("extraEntries = %#v, want legacy-tone", extraEntries)
	}

	legacyEntries, err := store.List(context.Background(), Filter{Layer: layerSceneStyle})
	if err != nil {
		t.Fatalf("List(layer=scene_style) error = %v", err)
	}
	if !hasPromptEntry(legacyEntries, "legacy-tone") {
		t.Fatalf("legacyEntries = %#v, want legacy filter to map to extra", legacyEntries)
	}
}

func TestStoreDeleteBuiltinDefaultIsReadonly(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	err := store.Delete(context.Background(), "image-concept")
	if !errors.Is(err, ErrBuiltinPromptEntryReadonly) {
		t.Fatalf("Delete() error = %v, want ErrBuiltinPromptEntryReadonly", err)
	}
}

func TestStoreSyncsChangedMarkdownForUnmodifiedBuiltins(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())
	if _, err := store.List(context.Background(), Filter{}); err != nil {
		t.Fatalf("initial List() error = %v", err)
	}

	store.defaults = fstest.MapFS{
		"prompt-library/builtin/image-concept.md": &fstest.MapFile{Data: []byte(testPromptEntryRaw("image-concept", "新版概念图", "image", "image", "", "新版内置提示"))},
	}
	updated, err := store.Get(context.Background(), "image-concept")
	if err != nil {
		t.Fatalf("Get() after markdown change error = %v", err)
	}
	if updated.Source != SourceBuiltin || updated.Name != "新版概念图" || updated.Prompt != "新版内置提示" {
		t.Fatalf("updated = %#v, want unmodified builtin to sync from markdown", updated)
	}
}

func TestStoreRejectsInvalidPromptEntries(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	cases := []PromptEntry{
		{ID: "../bad", Name: "Bad", Type: "image", Kind: "image", Prompt: "Bad"},
		{ID: "bad-type", Name: "Bad", Type: "audio", Kind: "image", Prompt: "Bad"},
		{ID: "bad-kind", Name: "Bad", Type: "image", Kind: "audio", Prompt: "Bad"},
		{ID: "bad-category", Name: "Bad", Type: "image", Kind: "image", Category: "../bad", Prompt: "Bad"},
	}
	for _, entry := range cases {
		_, err := store.Create(context.Background(), entry)
		if !errors.Is(err, ErrInvalidPromptEntry) {
			t.Fatalf("Create(%q) error = %v, want ErrInvalidPromptEntry", entry.ID, err)
		}
	}
}

func TestStoreRejectsInvalidListFilter(t *testing.T) {
	store, _ := newTestStore(t, testDefaultsFS())

	_, err := store.List(context.Background(), Filter{Type: "audio"})
	if !errors.Is(err, ErrInvalidPromptEntry) {
		t.Fatalf("List() error = %v, want ErrInvalidPromptEntry", err)
	}
}

func TestNewServiceLoadsBuiltinPromptEntries(t *testing.T) {
	repos, err := repository.OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}
	store := NewServiceWithRepository(configassets.PromptLibrary, builtinPromptLibraryDir, repos.PromptLibrary, nil)
	entries, err := store.List(context.Background(), Filter{Layer: layerExtra, Kind: "image"})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if !hasPromptEntry(entries, "character-multi-view") ||
		!hasPromptEntry(entries, "scene-four-view") {
		t.Fatalf("entries = %v, want built-in extra image prompts", entries)
	}
}

func newTestStore(t *testing.T, defaults fstest.MapFS) (*Service, *repository.PromptLibraryRepository) {
	t.Helper()
	repos, err := repository.OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}
	return NewServiceWithRepository(defaults, "prompt-library/builtin", repos.PromptLibrary, nil), repos.PromptLibrary
}

func testDefaultsFS() fstest.MapFS {
	return fstest.MapFS{
		"prompt-library/builtin/image-concept.md":        &fstest.MapFile{Data: []byte(testPromptEntryRaw("image-concept", "概念图", "image", "image", "", "内置提示"))},
		"prompt-library/builtin/video-shot.md":           &fstest.MapFile{Data: []byte(testPromptEntryRaw("video-shot", "镜头运动", "video", "video", "", "视频提示"))},
		"prompt-library/builtin/character-multi-view.md": &fstest.MapFile{Data: []byte(testPromptEntryRaw("character-multi-view", "多视图设定图", "image", "image", "character", "生成角色设定多视图。"))},
		"prompt-library/builtin/text-outline.md":         &fstest.MapFile{Data: []byte(testPromptEntryRaw("text-outline", "文本扩写", "", "text", "screenplay", "扩写文本。"))},
	}
}

func testPromptEntryRaw(id string, name string, promptType string, kind string, category string, prompt string) string {
	categoryLine := ""
	if category != "" {
		categoryLine = "category: " + category + "\n"
	}
	return `---
id: ` + id + `
name: ` + name + `
type: ` + promptType + `
kind: ` + kind + `
` + categoryLine + `---
` + prompt + `
`
}

func hasPromptEntry(entries []PromptEntry, id string) bool {
	for _, entry := range entries {
		if entry.ID == id {
			return true
		}
	}
	return false
}
