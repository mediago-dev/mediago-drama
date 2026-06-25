package prompt

import (
	"context"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"
)

func renderSection(id string, _ any) (string, error) {
	template, err := currentPromptTemplateStore().Get(context.Background(), id)
	if err != nil {
		return "", fmt.Errorf("load prompt instruction %s: %w", id, err)
	}
	content := official.RemoveMarkdownSection(template.Content, "内部模板（代码读取）")
	return strings.TrimSpace(content), nil
}

// InstructionTemplateSection returns a heading section from the active prompt
// instruction template store.
func InstructionTemplateSection(id string, headings ...string) (string, bool) {
	template, err := currentPromptTemplateStore().Get(context.Background(), id)
	if err != nil {
		return "", false
	}
	return official.ExtractMarkdownSection(template.Content, headings...)
}

// InvalidateTemplateCache is retained for callers from the old template renderer.
func InvalidateTemplateCache(_ string) {}
