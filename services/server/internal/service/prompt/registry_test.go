package prompt

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "prompt-tests-*")
	if err != nil {
		panic(err)
	}
	repos, err := repository.OpenSettingsRepositories(filepath.Join(dir, "settings.sqlite"))
	if err != nil {
		panic(err)
	}
	store := promptpack.NewServiceFromRepository(repos.Packs, repos.PromptLibrary, nil)
	SetPromptTemplateStore(prompttemplates.NewServiceFromRepository(repos.Instructions, nil))
	serviceskill.SetPromptPackStore(store)
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

func TestSectionRegistryLoadsInstructionEntries(t *testing.T) {
	descriptors := SectionDescriptors()
	if len(descriptors) != 2 {
		t.Fatalf("SectionDescriptors() = %#v, want two descriptors", descriptors)
	}
	if descriptors[0].ID != "AGENTS" || descriptors[1].ID != "TOOLS" {
		t.Fatalf("descriptors = %#v, want AGENTS then TOOLS", descriptors)
	}
}

func TestEditableSectionDescriptorsAreOrdered(t *testing.T) {
	descriptors := EditableSectionDescriptors()
	if len(descriptors) == 0 {
		t.Fatal("EditableSectionDescriptors() returned no descriptors")
	}
	for index := 1; index < len(descriptors); index++ {
		if descriptors[index-1].Order > descriptors[index].Order {
			t.Fatalf("descriptors out of order at %d: %q before %q", index, descriptors[index-1].ID, descriptors[index].ID)
		}
	}
}

func TestRenderSectionReturnsInstructionText(t *testing.T) {
	rendered, err := renderSection("AGENTS")
	if err != nil {
		t.Fatalf("renderSection() error = %v", err)
	}
	if !strings.Contains(rendered, "MediaGo Drama") {
		t.Fatalf("rendered = %q, want instruction body", rendered)
	}
	InvalidateTemplateCache("AGENTS")
}

func TestInstructionTemplateSectionFallsBackWhenOverrideContainsTemplateAction(t *testing.T) {
	restore := replacePromptTemplateStoreForTest(&fakePromptTemplateStore{
		templates: map[string]prompttemplates.PromptTemplate{
			"TOOLS": {
				ID: "TOOLS",
				Content: `## 内部模板（代码读取）

### 提示词优化系统指令

{{.Instruction}}
`,
			},
		},
	})
	defer restore()

	section, ok := InstructionTemplateSection("TOOLS", "内部模板（代码读取）", "提示词优化系统指令")
	if !ok {
		t.Fatal("InstructionTemplateSection() ok = false")
	}
	if strings.Contains(section, "{{") || !strings.Contains(section, "AI 绘画提示词优化专家") {
		t.Fatalf("section = %q, want fixed official template without variables", section)
	}
}

type fakePromptTemplateStore struct {
	templates map[string]prompttemplates.PromptTemplate
}

func (store *fakePromptTemplateStore) Load(_ context.Context) (map[string]prompttemplates.PromptTemplate, error) {
	return store.templates, nil
}

func (store *fakePromptTemplateStore) Get(_ context.Context, id string) (prompttemplates.PromptTemplate, error) {
	template, ok := store.templates[id]
	if !ok {
		return prompttemplates.PromptTemplate{}, fmt.Errorf("missing template %s", id)
	}
	return template, nil
}

func replacePromptTemplateStoreForTest(store promptTemplateStore) func() {
	promptTemplateStoreMu.Lock()
	previous := activePromptTemplate
	activePromptTemplate = store
	promptTemplateStoreMu.Unlock()
	return func() {
		promptTemplateStoreMu.Lock()
		activePromptTemplate = previous
		promptTemplateStoreMu.Unlock()
	}
}
