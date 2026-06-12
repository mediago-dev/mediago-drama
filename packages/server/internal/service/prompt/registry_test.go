package prompt

import (
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	configassets "github.com/mediago-dev/mediago-drama/packages/server/configs"
)

func TestSectionRegistryMatchesEmbeddedTemplates(t *testing.T) {
	entries, err := fs.ReadDir(configassets.PromptTemplates, "templates/prompts")
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}

	embedded := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		embedded[strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))] = true
	}

	seen := map[string]bool{}
	for _, descriptor := range SectionDescriptors() {
		if strings.TrimSpace(descriptor.ID) == "" {
			t.Fatalf("descriptor has empty ID: %#v", descriptor)
		}
		if seen[descriptor.ID] {
			t.Fatalf("duplicate descriptor ID %q", descriptor.ID)
		}
		seen[descriptor.ID] = true
		if !embedded[descriptor.ID] {
			t.Fatalf("descriptor %q has no embedded template", descriptor.ID)
		}
	}

	for id := range embedded {
		if !seen[id] {
			t.Fatalf("embedded template %q has no section descriptor", id)
		}
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
