package builtin

import (
	"context"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
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
		if entry.Kind != pack.KindSkill || entry.Slug != "novel-writer" {
			continue
		}
		foundNovelWriter = true
		hint, ok := entry.Metadata["hint"].(map[string]string)
		if !ok || hint["document_category"] != "reference" {
			t.Fatalf("novel-writer hint = %#v, want reference document category", entry.Metadata["hint"])
		}
	}
	if !foundNovelWriter {
		t.Fatal("builtin skills missing novel-writer")
	}
}
