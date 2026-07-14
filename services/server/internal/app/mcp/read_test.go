package mcp

import (
	"context"
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

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
	if output.Template != nil || strings.Contains(output.Content, "系统内置文档结构规则") {
		t.Fatalf("LoadSkill() = %#v, should not append document template rules", output)
	}
}

func TestLoadSkillResolvesBuiltinImageGenerationAcrossPromptPack(t *testing.T) {
	ctx := context.Background()
	store := newWorkspaceStateService(t.TempDir())
	adapter := NewAdapter(store, nil)

	output, err := adapter.LoadSkill(ctx, "", mediamcp.LoadSkillInput{Name: "image-generation"})
	if err != nil {
		t.Fatalf("LoadSkill(image-generation) error = %v", err)
	}
	if output.Name != "image-generation" ||
		!strings.Contains(output.Content, "# 图片生成与选片") ||
		!strings.Contains(output.Content, "kind: \"generation_plan\"") ||
		!strings.Contains(output.Content, "传输心跳") {
		t.Fatalf("LoadSkill(image-generation) = %#v, want builtin generation workflow", output)
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
