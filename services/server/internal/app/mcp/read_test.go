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
		!strings.Contains(output.Content, "# 图片生成") ||
		!strings.Contains(output.Content, "kind: \"generation_plan\"") ||
		!strings.Contains(output.Content, "传输心跳") ||
		!strings.Contains(output.Content, "图片生成请求成功提交后，当前 Agent run 的职责立即结束") ||
		!strings.Contains(output.Content, "不得在同一个 run 内调用 `get_generation_task`、`list_generation_tasks`、`poll_generation_task`、`retry_generation_task` 或 `select_generation_asset`") {
		t.Fatalf("LoadSkill(image-generation) = %#v, want builtin generation workflow", output)
	}
}

func TestLoadSkillResolvesBuiltinVideoGenerationAcrossPromptPack(t *testing.T) {
	ctx := context.Background()
	store := newWorkspaceStateService(t.TempDir())
	adapter := NewAdapter(store, nil)

	output, err := adapter.LoadSkill(ctx, "", mediamcp.LoadSkillInput{Name: "video-generation"})
	if err != nil {
		t.Fatalf("LoadSkill(video-generation) error = %v", err)
	}
	if output.Name != "video-generation" ||
		!strings.Contains(output.Content, "# 视频生成") ||
		!strings.Contains(output.Content, "kind: \"generation_plan\"") ||
		!strings.Contains(output.Content, "传输心跳") ||
		!strings.Contains(output.Content, "视频生成请求成功提交后，当前 Agent run 的职责立即结束") ||
		!strings.Contains(output.Content, "不得在同一个 run 内调用 `get_generation_task`、`list_generation_tasks`、`poll_generation_task`、`retry_generation_task` 或 `select_generation_asset`") {
		t.Fatalf("LoadSkill(video-generation) = %#v, want builtin submit-and-finish workflow", output)
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
