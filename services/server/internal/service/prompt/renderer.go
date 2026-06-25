package prompt

import (
	"context"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"
)

func renderSection(id string) (string, error) {
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
	section, ok := official.ExtractMarkdownSection(template.Content, headings...)
	if !ok {
		return "", false
	}
	if !containsTemplateAction(section) {
		return section, true
	}
	instruction, err := official.InstructionByID(context.Background(), id)
	if err != nil {
		return "", false
	}
	return official.ExtractMarkdownSection(instruction.Body, headings...)
}

// InvalidateTemplateCache is retained for callers from the old template renderer.
func InvalidateTemplateCache(_ string) {}

func containsTemplateAction(content string) bool {
	return strings.Contains(content, "{{") || strings.Contains(content, "}}")
}
