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
		counts[pack.KindInstruction] != 2 ||
		counts[pack.KindSkill] != 5 ||
		counts[pack.KindPrompt] != 10 {
		t.Fatalf("builtin manifest=%#v counts=%#v", bundle.Manifest, counts)
	}
}
