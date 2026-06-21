package skill

import (
	"context"
	"errors"
	"strings"
	"testing"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

func TestParseRawSkillFrontmatter(t *testing.T) {
	item, err := ParseRaw("screenplay-writer", testSkillRaw("screenplay-writer", "剧本指导", "正文"))
	if err != nil {
		t.Fatalf("ParseRaw() error = %v", err)
	}
	if item.Name != "screenplay-writer" || item.Description != "剧本指导" || !strings.Contains(item.Content, "正文") {
		t.Fatalf("skill = %#v, want parsed metadata and body", item)
	}
	if item.Hint["document_category"] != "screenplay" {
		t.Fatalf("hint = %#v, want document_category", item.Hint)
	}
}

func TestRegistryListsAndGetsSkillsFromPackStore(t *testing.T) {
	registry := NewRegistryWithStore(newFakeSkillPackStore())

	metas, err := registry.List(context.Background())
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("metas = %#v, want two skills", metas)
	}
	item, err := registry.Get(context.Background(), "screenplay-writer")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if item.Source != SourcePack || item.Description != "剧本指导" || !strings.Contains(item.Content, "正文") {
		t.Fatalf("skill = %#v, want pack-backed skill", item)
	}
}

func TestRegistrySaveCreatesUserOverride(t *testing.T) {
	packStore := newFakeSkillPackStore()
	registry := NewRegistryWithStore(packStore)

	saved, err := registry.Save(context.Background(), "screenplay-writer", testSkillRaw("screenplay-writer", "更新", "新正文"))
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Source != SourceUser || saved.Description != "更新" {
		t.Fatalf("saved = %#v, want user override", saved)
	}
	loaded, err := registry.Get(context.Background(), "screenplay-writer")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if loaded.Source != SourceUser || !strings.Contains(loaded.Content, "新正文") {
		t.Fatalf("loaded = %#v, want saved override", loaded)
	}
}

func TestRegistryCreateAndDeleteUserSkill(t *testing.T) {
	packStore := newFakeSkillPackStore()
	registry := NewRegistryWithStore(packStore)

	created, err := registry.Create(context.Background(), "custom-writer", testSkillRaw("custom-writer", "自定义", "正文"))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Name != "custom-writer" || created.Source != SourceUser {
		t.Fatalf("created = %#v, want user skill", created)
	}
	if err := registry.Delete(context.Background(), "custom-writer"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := registry.Get(context.Background(), "custom-writer"); !errors.Is(err, ErrSkillNotFound) {
		t.Fatalf("Get() error = %v, want ErrSkillNotFound", err)
	}
}

func TestRegistryNotFoundIncludesAvailableSkills(t *testing.T) {
	registry := NewRegistryWithStore(newFakeSkillPackStore())

	_, err := registry.Get(context.Background(), "missing")
	if !errors.Is(err, ErrSkillNotFound) || !strings.Contains(err.Error(), "screenplay-writer") {
		t.Fatalf("Get() error = %v, want not found with available list", err)
	}
}

type fakeSkillPackStore struct {
	entries map[string]promptpack.Entry
}

func newFakeSkillPackStore() *fakeSkillPackStore {
	return &fakeSkillPackStore{entries: map[string]promptpack.Entry{
		"screenplay-writer": {
			ID: "builtin/skill/screenplay-writer", PackID: "builtin", Kind: instructionpack.KindSkill,
			Slug: "screenplay-writer", Name: "screenplay-writer", Title: "剧本", Description: "剧本指导",
			Body: "正文", Source: "pack", Metadata: map[string]any{"hint": map[string]any{"document_category": "screenplay"}},
		},
		"scene-writer": {
			ID: "builtin/skill/scene-writer", PackID: "builtin", Kind: instructionpack.KindSkill,
			Slug: "scene-writer", Name: "scene-writer", Title: "场景", Description: "场景指导",
			Body: "场景正文", Source: "pack",
		},
	}}
}

func (store *fakeSkillPackStore) ListEntries(_ context.Context, kind instructionpack.Kind) ([]promptpack.Entry, error) {
	entries := []promptpack.Entry{}
	for _, entry := range store.entries {
		if entry.Kind == kind {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (store *fakeSkillPackStore) GetEntry(_ context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error) {
	entry, ok := store.entries[slug]
	if !ok || entry.Kind != kind {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	return entry, nil
}

func (store *fakeSkillPackStore) SaveEntry(_ context.Context, _ instructionpack.Kind, slug string, entry promptpack.Entry) (promptpack.Entry, error) {
	current, ok := store.entries[slug]
	if !ok {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	entry.ID = current.ID
	entry.PackID = current.PackID
	entry.Slug = slug
	entry.Source = "user"
	if current.Source != "user" || current.OverriddenFrom != "" {
		entry.OverriddenFrom = current.ID
	}
	store.entries[slug] = entry
	return entry, nil
}

func (store *fakeSkillPackStore) CreateEntry(_ context.Context, kind instructionpack.Kind, entry promptpack.Entry) (promptpack.Entry, error) {
	if _, exists := store.entries[entry.Slug]; exists {
		return promptpack.Entry{}, promptpack.ErrEntryExists
	}
	entry.ID = instructionpack.EntryID("builtin", kind, entry.Slug)
	entry.PackID = "builtin"
	entry.Kind = kind
	entry.Source = "user"
	store.entries[entry.Slug] = entry
	return entry, nil
}

func (store *fakeSkillPackStore) ResetEntry(_ context.Context, _ instructionpack.Kind, slug string) (promptpack.Entry, error) {
	entry, ok := store.entries[slug]
	if !ok {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	if entry.Source == "user" && entry.OverriddenFrom == "" {
		return promptpack.Entry{}, promptpack.ErrPackReadonly
	}
	entry.Source = "pack"
	entry.OverriddenFrom = ""
	store.entries[slug] = entry
	return entry, nil
}

func (store *fakeSkillPackStore) DeleteEntry(_ context.Context, _ instructionpack.Kind, slug string) error {
	entry, ok := store.entries[slug]
	if !ok {
		return promptpack.ErrEntryNotFound
	}
	if entry.Source != "user" {
		return promptpack.ErrPackReadonly
	}
	delete(store.entries, slug)
	return nil
}

func testSkillRaw(name string, description string, body string) string {
	return `---
name: ` + name + `
description: ` + description + `
hint:
  document_category: screenplay
---
# Heading

` + body + `
`
}
