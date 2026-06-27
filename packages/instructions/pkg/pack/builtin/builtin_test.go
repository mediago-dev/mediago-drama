package builtin

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/templates"
)

func TestBuiltinPackParses(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}
	counts := map[pack.Kind]int{}
	for _, entry := range bundle.Entries {
		counts[entry.Kind]++
	}
	if bundle.Manifest.ID != "builtin" ||
		counts[pack.KindSkill] != 6 ||
		counts[pack.KindPrompt] != 10 {
		t.Fatalf("builtin manifest=%#v counts=%#v", bundle.Manifest, counts)
	}
	foundNovelWriter := false
	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill {
			continue
		}
		hint, ok := entry.Metadata["hint"].(map[string]string)
		if !ok || hint["document_category"] == "" {
			t.Fatalf("%s hint = %#v, want document category", entry.Slug, entry.Metadata["hint"])
		}
		templateID := fmt.Sprint(entry.Metadata["template_id"])
		template, err := templates.TemplateByID(context.Background(), templateID)
		if err != nil {
			t.Fatalf("%s template_id = %q: %v", entry.Slug, templateID, err)
		}
		if template.DocumentCategory != hint["document_category"] {
			t.Fatalf("%s template category = %q, want %q", entry.Slug, template.DocumentCategory, hint["document_category"])
		}
		if entry.Slug == "novel-writer" {
			foundNovelWriter = true
			if hint["document_category"] != "reference" {
				t.Fatalf("novel-writer hint = %#v, want reference document category", entry.Metadata["hint"])
			}
		}
	}
	if !foundNovelWriter {
		t.Fatal("builtin skills missing novel-writer")
	}
}

func TestBuiltinCreativeSkillsDoNotBlockOnMissingVisualStyle(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	creativeSkillSlugs := map[string]bool{
		"character-writer": true,
		"scene-writer":     true,
		"prop-writer":      true,
	}
	blockingFragments := []string{
		"先定风格",
		"config.overview.style",
		"项目所选视觉风格",
		"项目视觉风格未设定",
		"先询问用户确认风格",
		"必须先在 Agent 面板直接询问用户",
		"不要在用户确认风格前继续",
	}
	found := map[string]bool{}
	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill || !creativeSkillSlugs[entry.Slug] {
			continue
		}
		found[entry.Slug] = true
		body := entry.Description + "\n" + entry.Body
		if !strings.Contains(body, "风格中性") {
			t.Fatalf("%s body should instruct neutral style fallback:\n%s", entry.Slug, body)
		}
		for _, fragment := range blockingFragments {
			if strings.Contains(body, fragment) {
				t.Fatalf("%s body contains blocking style fragment %q:\n%s", entry.Slug, fragment, body)
			}
		}
	}
	for slug := range creativeSkillSlugs {
		if !found[slug] {
			t.Fatalf("builtin skills missing %s", slug)
		}
	}
}
