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
	if documentRules := templates["DOCUMENT_RULES"]; documentRules.Content == "" || documentRules.Editable {
		t.Fatalf("DOCUMENT_RULES template = %#v, want non-editable official content", documentRules)
	}
	if _, ok := templates["PROMPT_OPTIMIZATION"]; ok {
		t.Fatalf("templates = %#v, should not include internal prompt optimization instruction", templates)
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

func TestInjectableTemplatesReturnsAgentInstructionTemplates(t *testing.T) {
	store := NewServiceWithStore(newFakeTemplateRepo())

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	ordered := InjectableTemplates(templates)
	ids := make([]string, 0, len(ordered))
	for _, template := range ordered {
		ids = append(ids, template.ID)
		if !template.Injectable {
			t.Fatalf("InjectableTemplates() included non-injectable template %#v", template)
		}
	}
	if strings.Join(ids, ",") != "AGENTS,TOOLS,DOCUMENT_RULES" {
		t.Fatalf("injectable ids = %v, want AGENTS,TOOLS,DOCUMENT_RULES", ids)
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
