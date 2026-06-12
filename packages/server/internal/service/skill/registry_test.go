package skill

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
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

func TestRegistryMergesBuiltinAndUserSkills(t *testing.T) {
	userDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(userDir, "screenplay-writer.skill.md"), []byte(testSkillRaw("screenplay-writer", "用户剧本指导", "用户正文")), 0o644); err != nil {
		t.Fatalf("writing user override: %v", err)
	}
	if err := os.WriteFile(filepath.Join(userDir, "my-custom-guide.skill.md"), []byte(testSkillRaw("my-custom-guide", "自定义指导", "自定义正文")), 0o644); err != nil {
		t.Fatalf("writing user skill: %v", err)
	}

	registry := NewRegistryWithSource(fstest.MapFS{
		"skills/builtin/screenplay-writer.skill.md": &fstest.MapFile{Data: []byte(testSkillRaw("screenplay-writer", "内置剧本指导", "内置正文"))},
		"skills/builtin/broken.skill.md":            &fstest.MapFile{Data: []byte("not frontmatter")},
	}, "skills/builtin", userDir)

	metas, err := registry.List(context.Background())
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("metas = %#v, want broken skipped and two valid skills", metas)
	}
	item, err := registry.Get(context.Background(), "screenplay-writer")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if item.Source != SourceUser || item.Description != "用户剧本指导" || !strings.Contains(item.Content, "用户正文") {
		t.Fatalf("overridden skill = %#v, want user precedence", item)
	}
}

func TestRegistrySaveCreatesUserOverrideForBuiltinSkill(t *testing.T) {
	userDir := t.TempDir()
	registry := NewRegistryWithSource(fstest.MapFS{
		"skills/builtin/screenplay-writer.skill.md": &fstest.MapFile{Data: []byte(testSkillRaw("screenplay-writer", "内置剧本指导", "内置正文"))},
	}, "skills/builtin", userDir)

	saved, err := registry.Save(context.Background(), "screenplay-writer", testSkillRaw("screenplay-writer", "更新", "正文"))
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
	if loaded.Source != SourceUser || loaded.Description != "更新" || !strings.Contains(loaded.Content, "正文") {
		t.Fatalf("loaded = %#v, want user override", loaded)
	}
}

func TestRegistryNotFoundIncludesAvailableSkills(t *testing.T) {
	registry := NewRegistryWithSource(fstest.MapFS{
		"skills/builtin/screenplay-writer.skill.md": &fstest.MapFile{Data: []byte(testSkillRaw("screenplay-writer", "内置剧本指导", "内置正文"))},
	}, "skills/builtin", filepath.Join(t.TempDir(), "missing"))

	_, err := registry.Get(context.Background(), "missing")
	if !errors.Is(err, ErrSkillNotFound) || !strings.Contains(err.Error(), "screenplay-writer") {
		t.Fatalf("Get() error = %v, want not found with available list", err)
	}
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
