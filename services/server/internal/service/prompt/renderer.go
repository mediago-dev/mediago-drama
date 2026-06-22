package prompt

import (
	"context"
	"fmt"
	"strings"
)

func renderSection(id string, _ any) (string, error) {
	template, err := currentPromptTemplateStore().Get(context.Background(), id)
	if err != nil {
		return "", fmt.Errorf("load prompt instruction %s: %w", id, err)
	}
	return strings.TrimSpace(template.Content), nil
}

// InvalidateTemplateCache is retained for callers from the old template renderer.
func InvalidateTemplateCache(_ string) {}
