package prompttemplates

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
)

func TestStoreLoadFallsBackToEmbeddedTemplates(t *testing.T) {
	store := NewServiceWithSource(testDefaultsFS("Embedded"), filepath.Join(t.TempDir(), "missing"))

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	template := templates["TOOLS"]
	if template.Content != "Embedded\n" {
		t.Fatalf("Load() content = %q, want Embedded", template.Content)
	}
}

func TestStoreLoadOverlaysDiskTemplates(t *testing.T) {
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "TOOLS.md"), []byte("Disk\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	store := NewServiceWithSource(testDefaultsFS("Embedded"), sourceDir)

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	template := templates["TOOLS"]
	if template.Content != "Disk\n" {
		t.Fatalf("Load() content = %q, want Disk", template.Content)
	}
}

func TestStoreSaveWritesPromptTemplate(t *testing.T) {
	sourceDir := t.TempDir()
	store := NewServiceWithSource(testDefaultsFS("Embedded"), sourceDir)
	template := PromptTemplate{ID: "TOOLS", Content: "Saved"}

	saved, err := store.Save(context.Background(), template.ID, template)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Name != "TOOLS.md" || saved.Content != "Saved\n" {
		t.Fatalf("Save() = %#v, want metadata and normalized content", saved)
	}

	data, err := os.ReadFile(filepath.Join(sourceDir, "TOOLS.md"))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(data) != "Saved\n" {
		t.Fatalf("saved file = %q, want normalized content", data)
	}
}

func TestStoreSaveInvalidatesPromptCache(t *testing.T) {
	serviceprompt.InvalidateTemplateCache("AGENTS")
	t.Cleanup(func() {
		if err := os.RemoveAll("configs"); err != nil {
			t.Fatalf("RemoveAll() error = %v", err)
		}
		serviceprompt.InvalidateTemplateCache("AGENTS")
	})

	initial := serviceprompt.BuildWorkspaceACPPrompt(serviceprompt.AgentRunRequest{
		WorkspaceDir: t.TempDir(),
	})
	if strings.Contains(initial, "cache invalidated marker") {
		t.Fatalf("initial prompt unexpectedly contains saved marker")
	}

	store := NewService()
	_, err := store.Save(context.Background(), "AGENTS", PromptTemplate{
		ID:      "AGENTS",
		Content: "cache invalidated marker",
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	prompt := serviceprompt.BuildWorkspaceACPPrompt(serviceprompt.AgentRunRequest{
		WorkspaceDir: t.TempDir(),
	})
	if !strings.Contains(prompt, "cache invalidated marker") {
		t.Fatalf("prompt = %q, want saved template after cache invalidation", prompt)
	}
}

func TestStoreSaveRejectsInvalidTemplate(t *testing.T) {
	store := NewServiceWithSource(testDefaultsFS("Embedded"), t.TempDir())
	template := PromptTemplate{ID: "TOOLS"}

	_, err := store.Save(context.Background(), template.ID, template)
	if !errors.Is(err, ErrInvalidTemplate) {
		t.Fatalf("Save() error = %v, want ErrInvalidTemplate", err)
	}
}

func testDefaultsFS(content string) fs.FS {
	return fstest.MapFS{
		"templates/prompts/TOOLS.md": &fstest.MapFile{Data: []byte(content)},
	}
}

func TestOrderedTemplatesUsesPromptAssemblyOrder(t *testing.T) {
	ordered := OrderedTemplates(map[string]PromptTemplate{
		"TOOLS":  {ID: "TOOLS"},
		"AGENTS": {ID: "AGENTS"},
	})

	ids := make([]string, 0, len(ordered))
	for _, template := range ordered {
		ids = append(ids, template.ID)
	}
	if strings.Join(ids, ",") != "AGENTS,TOOLS" {
		t.Fatalf("ordered ids = %v", ids)
	}
}

func TestStoreLoadUsesEditableRegistry(t *testing.T) {
	defaults := fstest.MapFS{
		"templates/prompts/AGENTS.md":        &fstest.MapFile{Data: []byte("Role")},
		"templates/prompts/CONTEXT.md":       &fstest.MapFile{Data: []byte("Context")},
		"templates/prompts/unknown_extra.md": &fstest.MapFile{Data: []byte("Unknown")},
	}
	store := NewServiceWithSource(defaults, filepath.Join(t.TempDir(), "missing"))

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if _, ok := templates["unknown_extra"]; ok {
		t.Fatalf("Load() returned unknown template: %#v", templates["unknown_extra"])
	}
	if _, ok := templates["CONTEXT"]; ok {
		t.Fatalf("Load() returned runtime-only CONTEXT template: %#v", templates["CONTEXT"])
	}
	template, ok := templates["AGENTS"]
	if !ok {
		t.Fatalf("Load() missing AGENTS template")
	}
	if template.Name != "AGENTS.md" {
		t.Fatalf("AGENTS name = %q, want registry metadata", template.Name)
	}
}

func TestStoreLoadArchivesLegacyDiskTemplates(t *testing.T) {
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "role_persona.md"), []byte("Legacy\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() legacy error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "TOOLS.md"), []byte("Disk\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() current error = %v", err)
	}
	store := NewServiceWithSource(testDefaultsFS("Embedded"), sourceDir)

	templates, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if templates["TOOLS"].Content != "Disk\n" {
		t.Fatalf("TOOLS content = %q, want current disk override", templates["TOOLS"].Content)
	}
	if _, err := os.Stat(filepath.Join(sourceDir, "role_persona.md")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("legacy source stat error = %v, want not exist", err)
	}
	archived, err := os.ReadFile(filepath.Join(sourceDir, "legacy", "role_persona.md"))
	if err != nil {
		t.Fatalf("ReadFile() archived legacy error = %v", err)
	}
	if string(archived) != "Legacy\n" {
		t.Fatalf("archived legacy = %q, want original content", archived)
	}
}
