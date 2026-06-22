package prompttemplates

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestStoreLoadReturnsOfficialInstructions(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplateRepo())

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if templates["TOOLS"].Content == "" || templates["TOOLS"].Source != sourceOfficial {
		t.Fatalf("TOOLS template = %#v, want official content", templates["TOOLS"])
	}
}

func TestStoreSaveWritesUserOverride(t *testing.T) {
	repo := newFakeTemplateRepo()
	store := NewServiceWithStore(repo)

	saved, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS", Content: "Saved"})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Content != "Saved\n" || saved.Source != sourceUser || !saved.Overridden {
		t.Fatalf("saved = %#v, want normalized user override", saved)
	}
	if repo.models["TOOLS"].Content != "Saved\n" {
		t.Fatalf("stored content = %q, want Saved", repo.models["TOOLS"].Content)
	}
}

func TestStoreResetRestoresOfficialInstruction(t *testing.T) {
	repo := newFakeTemplateRepo()
	store := NewServiceWithStore(repo)

	if _, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS", Content: "Saved"}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	reset, err := store.Reset(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("Reset() error = %v", err)
	}
	if reset.Source != sourceOfficial || reset.Overridden || !strings.Contains(reset.Content, "工具使用原则") {
		t.Fatalf("reset = %#v, want official instruction", reset)
	}
	if _, ok := repo.models["TOOLS"]; ok {
		t.Fatal("override still exists after reset")
	}
}

func TestStoreSaveRejectsInvalidTemplate(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplateRepo())

	_, err := store.Save(context.Background(), "TOOLS", PromptTemplate{ID: "TOOLS"})
	if !errors.Is(err, ErrInvalidTemplate) {
		t.Fatalf("Save() error = %v, want ErrInvalidTemplate", err)
	}
}

func TestStoreSaveRejectsUnknownTemplate(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplateRepo())

	_, err := store.Save(context.Background(), "UNKNOWN", PromptTemplate{ID: "UNKNOWN", Content: "Saved"})
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

type fakeTemplateRepo struct {
	models map[string]domain.InstructionTemplateModel
}

func newFakeTemplateRepo() *fakeTemplateRepo {
	return &fakeTemplateRepo{models: map[string]domain.InstructionTemplateModel{}}
}

func (repo *fakeTemplateRepo) List(_ context.Context) ([]domain.InstructionTemplateModel, error) {
	models := make([]domain.InstructionTemplateModel, 0, len(repo.models))
	for _, model := range repo.models {
		models = append(models, model)
	}
	return models, nil
}

func (repo *fakeTemplateRepo) Upsert(_ context.Context, model domain.InstructionTemplateModel) error {
	repo.models[model.ID] = model
	return nil
}

func (repo *fakeTemplateRepo) Delete(_ context.Context, id string) error {
	delete(repo.models, id)
	return nil
}
