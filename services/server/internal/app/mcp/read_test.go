package mcp

import (
	"context"
	"strings"
	"testing"

	instructiontemplates "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/templates"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
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

func TestLoadSkillReadsWorkspaceSettingsDB(t *testing.T) {
	ctx := context.Background()
	store := newWorkspaceStateService(t.TempDir())
	registry := newSkillRegistryForWorkspace(store)
	const skillName = "mcp-hot-skill"
	const skillBody = "hot skill body from workspace settings"
	if _, err := registry.Create(ctx, skillName, testMCPRawSkill(skillName, "Hot skill", skillBody)); err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	adapter := NewAdapter(store, nil)
	output, err := adapter.LoadSkill(ctx, "", mediamcp.LoadSkillInput{Name: skillName})
	if err != nil {
		t.Fatalf("LoadSkill() error = %v", err)
	}
	if output.Name != skillName || !strings.Contains(output.Content, skillBody) {
		t.Fatalf("LoadSkill() = %#v, want workspace skill body", output)
	}
}

func testMCPRawSkill(name string, description string, body string) string {
	return `---
name: ` + name + `
description: ` + description + `
---

` + body + `
`
}
