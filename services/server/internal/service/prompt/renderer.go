package prompt

import (
	"context"
	"fmt"
	"strings"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

func renderSection(id string, _ any) (string, error) {
	entry, err := currentPackStore().GetEntry(context.Background(), instructionpack.KindInstruction, id)
	if err != nil {
		return "", fmt.Errorf("load prompt instruction %s: %w", id, err)
	}
	return strings.TrimSpace(entry.Body), nil
}

// InvalidateTemplateCache is retained for callers from the old template renderer.
func InvalidateTemplateCache(_ string) {}
