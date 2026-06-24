package mcp

import (
	"strings"
	"testing"

	instructiontemplates "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/templates"
)

func TestAppendDocumentTemplateAddsReadOnlyTemplateBlock(t *testing.T) {
	content := appendDocumentTemplate("Skill body\n", instructiontemplates.Template{
		ID:               "screenplay.v1",
		Name:             "剧本文档模板",
		DocumentCategory: "screenplay",
		Body:             "# 第一章\n\n## 1-1\n",
	})

	for _, want := range []string{
		"Skill body",
		"## 系统内置模板格式（只读）",
		"```markdown\n# 第一章\n\n## 1-1\n```",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("content = %q, want fragment %q", content, want)
		}
	}
}
