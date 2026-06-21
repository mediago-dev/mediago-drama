package prompttemplates

import (
	"context"
	"errors"
	"strings"
	"testing"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

func TestStoreLoadReturnsEditableInstructions(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplatePackStore())

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if _, ok := templates["RUNTIME"]; ok {
		t.Fatalf("Load() returned non-editable runtime template")
	}
	if templates["TOOLS"].Content != "Tools body\n" {
		t.Fatalf("TOOLS content = %q, want pack body", templates["TOOLS"].Content)
	}
}

func TestStoreSaveWritesUserOverride(t *testing.T) {
	packStore := newFakeTemplatePackStore()
	store := NewServiceWithStore(packStore)

	saved, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS", Content: "Saved"})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Content != "Saved\n" || packStore.entries["TOOLS"].Source != "user" || !saved.Overridden {
		t.Fatalf("saved = %#v source=%q, want normalized user override", saved, packStore.entries["TOOLS"].Source)
	}
}

func TestStoreResetRestoresPackInstruction(t *testing.T) {
	packStore := newFakeTemplatePackStore()
	store := NewServiceWithStore(packStore)

	if _, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS", Content: "Saved"}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	reset, err := store.Reset(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("Reset() error = %v", err)
	}
	if reset.Content != "Tools body\n" || reset.Source != "pack" || reset.Overridden {
		t.Fatalf("reset = %#v, want pack instruction", reset)
	}
}

func TestStoreSaveRejectsInvalidTemplate(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplatePackStore())

	_, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS"})
	if !errors.Is(err, ErrInvalidTemplate) {
		t.Fatalf("Save() error = %v, want ErrInvalidTemplate", err)
	}
}

func TestOrderedTemplatesUsesPromptAssemblyOrder(t *testing.T) {
	ordered := OrderedTemplates(map[string]PromptTemplate{
		"TOOLS":  {ID: "TOOLS", Order: 1},
		"AGENTS": {ID: "AGENTS", Order: 0},
	})

	ids := make([]string, 0, len(ordered))
	for _, template := range ordered {
		ids = append(ids, template.ID)
	}
	if strings.Join(ids, ",") != "AGENTS,TOOLS" {
		t.Fatalf("ordered ids = %v", ids)
	}
}

type fakeTemplatePackStore struct {
	entries map[string]promptpack.Entry
}

func newFakeTemplatePackStore() *fakeTemplatePackStore {
	return &fakeTemplatePackStore{
		entries: map[string]promptpack.Entry{
			"AGENTS": {
				ID: "builtin/instruction/AGENTS", PackID: "builtin", Kind: instructionpack.KindInstruction,
				Slug: "AGENTS", Name: "AGENTS.md", Title: "AGENTS.md", Body: "Agents body",
				Metadata: map[string]any{"order": 0, "editable": true}, Source: "pack",
			},
			"TOOLS": {
				ID: "builtin/instruction/TOOLS", PackID: "builtin", Kind: instructionpack.KindInstruction,
				Slug: "TOOLS", Name: "TOOLS.md", Title: "TOOLS.md", Body: "Tools body",
				Metadata: map[string]any{"order": 1, "editable": true}, Source: "pack",
			},
			"RUNTIME": {
				ID: "builtin/instruction/RUNTIME", PackID: "builtin", Kind: instructionpack.KindInstruction,
				Slug: "RUNTIME", Name: "Runtime", Title: "Runtime", Body: "Runtime body",
				Metadata: map[string]any{"order": 2, "editable": false}, Source: "pack",
			},
		},
	}
}

func (store *fakeTemplatePackStore) ListEntries(_ context.Context, kind instructionpack.Kind) ([]promptpack.Entry, error) {
	entries := []promptpack.Entry{}
	for _, entry := range store.entries {
		if entry.Kind == kind {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (store *fakeTemplatePackStore) GetEntry(_ context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error) {
	entry, ok := store.entries[slug]
	if !ok || entry.Kind != kind {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	return entry, nil
}

func (store *fakeTemplatePackStore) SaveEntry(_ context.Context, _ instructionpack.Kind, slug string, entry promptpack.Entry) (promptpack.Entry, error) {
	current, ok := store.entries[slug]
	if !ok {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	entry.ID = current.ID
	entry.PackID = current.PackID
	entry.Slug = slug
	entry.Source = "user"
	entry.OverriddenFrom = current.ID
	store.entries[slug] = entry
	return entry, nil
}

func (store *fakeTemplatePackStore) ResetEntry(_ context.Context, _ instructionpack.Kind, slug string) (promptpack.Entry, error) {
	entry, ok := store.entries[slug]
	if !ok {
		return promptpack.Entry{}, promptpack.ErrEntryNotFound
	}
	if entry.Source == "user" && entry.OverriddenFrom == "" {
		return promptpack.Entry{}, promptpack.ErrPackReadonly
	}
	entry.Body = strings.TrimSuffix(entry.Title, ".md") + " body"
	if slug == "TOOLS" {
		entry.Body = "Tools body"
	}
	if slug == "AGENTS" {
		entry.Body = "Agents body"
	}
	entry.Source = "pack"
	entry.OverriddenFrom = ""
	store.entries[slug] = entry
	return entry, nil
}
