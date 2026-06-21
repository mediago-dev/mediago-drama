package promptlibrary

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

func TestStoreSeedsBuiltinPromptEntries(t *testing.T) {
	store := newTestStore(t)

	entries, err := store.List(context.Background(), Filter{Category: categoryExtra})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if !hasPromptEntry(entries, "image-character-concept") ||
		!hasPromptEntry(entries, "scene-four-view") {
		t.Fatalf("entries = %#v, want built-in extra prompts", entries)
	}

	styleEntries, err := store.List(context.Background(), Filter{Category: categoryStyle})
	if err != nil {
		t.Fatalf("List(style) error = %v", err)
	}
	if !hasPromptEntry(styleEntries, "realistic") {
		t.Fatalf("styleEntries = %#v, want style presets", styleEntries)
	}
}

func TestStoreListsAndCreatesPromptCategories(t *testing.T) {
	store := newTestStore(t)

	categories, err := store.ListCategories(context.Background())
	if err != nil {
		t.Fatalf("ListCategories() error = %v", err)
	}
	if !hasPromptCategory(categories, categoryStyle) || !hasPromptCategory(categories, categoryExtra) {
		t.Fatalf("categories = %#v, want built-in prompt categories", categories)
	}

	created, err := store.CreateCategory(context.Background(), PromptCategory{Label: "镜头"})
	if err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if created.ID != "镜头" || created.Label != "镜头" || created.Source != SourceUser || created.Builtin {
		t.Fatalf("created = %#v, want user category", created)
	}

	if _, err := store.CreateCategory(context.Background(), PromptCategory{Label: categoryStyleLabel}); !errors.Is(err, ErrPromptCategoryExists) {
		t.Fatalf("CreateCategory(duplicate label) error = %v, want ErrPromptCategoryExists", err)
	}
}

func TestStoreUpdateBuiltinCreatesOverrideAndResetRestoresDefault(t *testing.T) {
	store := newTestStore(t)

	updated, err := store.Update(context.Background(), "image-character-concept", PromptEntry{
		ID:       "image-character-concept",
		Name:     "自定义角色概念图",
		Category: categoryExtra,
		Type:     "image",
		Prompt:   "用户覆盖。",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Source != SourceUser || !updated.Builtin || !updated.Overridden || updated.Prompt != "用户覆盖。" {
		t.Fatalf("updated = %#v, want user override for package prompt", updated)
	}

	reset, err := store.Reset(context.Background(), "image-character-concept")
	if err != nil {
		t.Fatalf("Reset() error = %v", err)
	}
	if reset.Source != SourcePack || !reset.Builtin || reset.Overridden || reset.Name != "角色概念图" || reset.Prompt == "用户覆盖。" {
		t.Fatalf("reset = %#v, want package default", reset)
	}
}

func TestStoreCreateUpdateAndDeleteUserPromptEntry(t *testing.T) {
	store := newTestStore(t)

	created, err := store.Create(context.Background(), PromptEntry{
		ID:       "noir-image",
		Name:     "黑色电影图像",
		Category: "镜头",
		Type:     "image",
		Prompt:   "低调光，强反差。",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Source != SourceUser || created.Builtin || created.Category != "镜头" {
		t.Fatalf("created = %#v, want user image prompt with custom category", created)
	}

	updated, err := store.Update(context.Background(), "noir-image", PromptEntry{
		ID:       "noir-image",
		Name:     "黑色电影图像",
		Category: "镜头",
		Type:     "image",
		Prompt:   "雨夜，强反差。",
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

func TestStoreDeleteBuiltinDefaultIsReadonly(t *testing.T) {
	store := newTestStore(t)

	err := store.Delete(context.Background(), "image-character-concept")
	if !errors.Is(err, ErrBuiltinPromptEntryReadonly) {
		t.Fatalf("Delete() error = %v, want ErrBuiltinPromptEntryReadonly", err)
	}
}

func TestStoreRejectsInvalidPromptEntries(t *testing.T) {
	store := newTestStore(t)

	cases := []PromptEntry{
		{ID: "../bad", Name: "Bad", Type: "image", Prompt: "Bad"},
		{ID: "bad-type", Name: "Bad", Type: "audio", Prompt: "Bad"},
		{ID: "bad-category", Name: "Bad", Type: "image", Category: "../bad", Prompt: "Bad"},
	}
	for _, entry := range cases {
		_, err := store.Create(context.Background(), entry)
		if !errors.Is(err, ErrInvalidPromptEntry) {
			t.Fatalf("Create(%q) error = %v, want ErrInvalidPromptEntry", entry.ID, err)
		}
	}
}

func TestStoreRejectsInvalidListFilter(t *testing.T) {
	store := newTestStore(t)

	_, err := store.List(context.Background(), Filter{Type: "audio"})
	if !errors.Is(err, ErrInvalidPromptEntry) {
		t.Fatalf("List() error = %v, want ErrInvalidPromptEntry", err)
	}
}

func newTestStore(t *testing.T) *Service {
	t.Helper()
	repos, err := repository.OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}
	packStore := promptpack.NewServiceFromRepository(repos.Packs, repos.PromptLibrary, nil)
	return NewServiceFromPromptPack(packStore, nil)
}

func hasPromptEntry(entries []PromptEntry, id string) bool {
	for _, entry := range entries {
		if entry.ID == id {
			return true
		}
	}
	return false
}

func hasPromptCategory(categories []PromptCategory, id string) bool {
	for _, category := range categories {
		if category.ID == id {
			return true
		}
	}
	return false
}
