package builtin

import (
	"context"
	"fmt"
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
