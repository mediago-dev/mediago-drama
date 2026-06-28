package prompt

import (
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

func TestEditableSectionDescriptorsReturnsAgentInstructions(t *testing.T) {
	descriptors := EditableSectionDescriptors()
	if len(descriptors) != 2 {
		t.Fatalf("EditableSectionDescriptors() = %#v, want two descriptors", descriptors)
	}
	if descriptorIDsContain(descriptors, "PROMPT_OPTIMIZATION") {
		t.Fatalf("EditableSectionDescriptors() = %#v, should not include PROMPT_OPTIMIZATION", descriptors)
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

func TestPromptOptimizationIsNotInstructionTemplateSection(t *testing.T) {
	_, ok := InstructionTemplateSection("PROMPT_OPTIMIZATION", "提示词优化系统指令")
	if !ok {
		return
	}
	t.Fatal("InstructionTemplateSection(PROMPT_OPTIMIZATION) ok = true, want false")
}

func descriptorIDsContain(descriptors []SectionDescriptor, id string) bool {
	for _, descriptor := range descriptors {
		if descriptor.ID == id {
			return true
		}
	}
	return false
}
