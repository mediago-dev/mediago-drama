package mcp

import (
	"strings"
	"testing"

	instructiontemplates "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/templates"
)

func TestAppendDocumentStructureRulesAddsInternalRulesBlock(t *testing.T) {
	content := appendDocumentStructureRules("Skill body\n", instructiontemplates.Template{
		ID:               "screenplay.v1",
		Name:             "剧本文档模板",
		DocumentCategory: "screenplay",
		Body:             "# 第一章\n\n## 1-1\n",
	})

	for _, want := range []string{
		"Skill body",
		"## 系统内置文档结构规则（内部）",
		"```markdown\n# 第一章\n\n## 1-1\n```",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("content = %q, want fragment %q", content, want)
		}
	}
}
