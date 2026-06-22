package prompt

import (
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

func TestPromptBuilderUsesFixedAgentPrompt(t *testing.T) {
	prompt := BuildWorkspaceACPPrompt(AgentRunRequest{
		ProjectID:    "project-1",
		WorkspaceDir: t.TempDir(),
		Document:     &AgentDocumentContext{ID: "doc-1", Title: "第一集", Content: "# 第一集"},
	})

	if !strings.Contains(prompt, "你是 MediaGo Drama 的项目 Agent。") ||
		!strings.Contains(prompt, "当前工作目录已经是当前项目的文档根目录") ||
		!strings.Contains(prompt, "不要再访问或创建名为 `work/` 的子目录") ||
		!strings.Contains(prompt, "不要把整篇内容一次性放进单个 `write` / `edit` 工具调用") ||
		!strings.Contains(prompt, "长文档生成要分批落盘") ||
		!strings.Contains(prompt, "每次写入参数要小") ||
		!strings.Contains(prompt, "最多 2 个分镜为一批") {
		t.Fatalf("prompt = %q, want fixed agent persona", prompt)
	}
	if strings.Contains(prompt, "当前绑定角色：") ||
		strings.Contains(prompt, "本地 Skill（来自 SKILL.md") ||
		strings.Contains(prompt, "spawn"+"_agents") ||
		strings.Contains(prompt, "container"+"DocumentIds") {
		t.Fatalf("prompt = %q, should not contain role, skill, spawn, or container sections", prompt)
	}
	assertNoInlineToolUsageCatalog(t, prompt)
}

func TestPromptBuilderDoesNotInlineProjectBrief(t *testing.T) {
	brief := ProjectBrief{
		Medium: "2D 数码插画",
		Genre:  "沙雕喜剧",
		Pacing: "短剧，每集 60 秒",
		Style:  "明亮糖果色，厚涂质感",
	}

	prompt := BuildWorkspaceACPPrompt(AgentRunRequest{
		ProjectID:    "project-brief",
		WorkspaceDir: t.TempDir(),
		Documents: []AgentDocumentContext{
			{
				ID:      model.OverviewDocumentID,
				Title:   "项目概览",
				Content: model.DefaultProjectOverviewMarkdown("项目", "", brief),
			},
		},
	})

	for _, value := range []string{
		"## 当前项目设定（Project Brief）",
		"2D 数码插画",
		"沙雕喜剧",
		"短剧，每集 60 秒",
		"明亮糖果色，厚涂质感",
	} {
		if strings.Contains(prompt, value) {
			t.Fatalf("prompt = %q, should not inline project brief value %q", prompt, value)
		}
	}
}

func TestPromptBuilderDoesNotInlineScopedEditContext(t *testing.T) {
	prompt := BuildWorkspaceACPPrompt(AgentRunRequest{
		ProjectID:     "project-1",
		Prompt:        "优化这段台词",
		SelectionText: "旧台词",
		Document: &AgentDocumentContext{
			ID:      "doc-1",
			Title:   "对白",
			Content: "## 场景\n\n旧台词\n",
		},
	})

	for _, value := range []string{
		"后端结构化局部编辑上下文",
		"目标块当前内容",
		"旧台词",
		"根据用户请求优化选中文本所在的 Markdown 块",
	} {
		if strings.Contains(prompt, value) {
			t.Fatalf("prompt = %q, should not inline scoped edit value %q", prompt, value)
		}
	}
	if !strings.Contains(prompt, "用户请求：\n优化这段台词") {
		t.Fatalf("prompt = %q, want explicit user prompt kept", prompt)
	}
}

func TestPromptBuilderDoesNotInlineAssetReferences(t *testing.T) {
	prompt := BuildWorkspaceACPPrompt(AgentRunRequest{
		ProjectID: "project-1",
		References: []AgentReference{
			{
				Kind:       "asset",
				DocumentID: "asset-1",
				AssetID:    "asset-1",
				AssetKind:  "image",
				MIMEType:   "image/png",
				Title:      "参考图.png",
				Category:   "reference",
				URL:        "/api/v1/projects/project-1/assets/asset-1/content",
			},
		},
	})

	for _, want := range []string{
		"用户 @ 引用：",
		"参考图.png | kind: asset",
		"assetId: asset-1",
		"assetKind: image",
		"mimeType: image/png",
		"url: /api/v1/projects/project-1/assets/asset-1/content",
	} {
		if strings.Contains(prompt, want) {
			t.Fatalf("prompt = %q, should not inline asset reference segment %q", prompt, want)
		}
	}
}

func TestPromptBuilderIndexesResourceMentionsWithoutDocumentBodies(t *testing.T) {
	prompt := BuildWorkspaceACPPrompt(AgentRunRequest{
		ProjectID: "project-1",
		Document: &AgentDocumentContext{
			ID:       "storyboard-doc",
			Title:    "第一集分镜",
			Category: "storyboard",
			Content:  "# 第一集分镜",
		},
		Documents: []AgentDocumentContext{
			{
				ID:       "character-doc",
				Title:    "角色设定",
				Category: "character",
				Content: strings.Join([]string{
					"<!-- section-id: section_shenyan -->",
					"# 沈阎",
					"",
					"玄色长袍，银白发丝，眼尾冷峻。这段正文不能进入资源索引。",
				}, "\n"),
			},
		},
	})

	for _, want := range []string{
		"# 可用 @ 资源索引",
		"角色｜沈阎",
		"@[沈阎](mention://character-doc/section_shenyan)",
		"不要把 `mention://` 或 `asset://` 内部链接写入",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt = %q, want reference index segment %q", prompt, want)
		}
	}
	if strings.Contains(prompt, "玄色长袍") || strings.Contains(prompt, "这段正文不能进入资源索引") {
		t.Fatalf("prompt = %q, should not inline resource document body", prompt)
	}
}

func TestPromptBuilderAdvertisesSkillForBusinessDocuments(t *testing.T) {
	tests := []struct {
		name      string
		category  string
		skillName string
	}{
		{
			name:      "screenplay",
			category:  "screenplay",
			skillName: "screenplay-writer",
		},
		{
			name:      "character",
			category:  "character",
			skillName: "character-writer",
		},
		{
			name:      "scene",
			category:  "scene",
			skillName: "scene-writer",
		},
		{
			name:      "prop",
			category:  "prop",
			skillName: "prop-writer",
		},
		{
			name:      "storyboard",
			category:  "storyboard",
			skillName: "storyboard-writer",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prompt := BuildACPPrompt(AgentRunRequest{
				ProjectID: "project-1",
				Document: &AgentDocumentContext{
					ID:       "doc-1",
					Title:    "业务文档",
					Category: test.category,
					Content:  "# 业务文档",
				},
			}, PromptBuildOptions{})

			if !strings.Contains(prompt, test.skillName+":") {
				t.Fatalf("prompt = %q, want skill index entry %s", prompt, test.skillName)
			}
			assertNoInlineToolUsageCatalog(t, prompt)
			assertNoInlineCategoryGuidance(t, prompt)
		})
	}
}

func TestPromptBuilderDoesNotInlineCategoryGuidance(t *testing.T) {
	tests := []struct {
		name     string
		document *AgentDocumentContext
	}{
		{
			name:     "nil document",
			document: nil,
		},
		{
			name: "reference",
			document: &AgentDocumentContext{
				ID:       "doc-1",
				Title:    "原素材",
				Category: "reference",
				Content:  "原始素材",
			},
		},
		{
			name: "overview",
			document: &AgentDocumentContext{
				ID:       model.OverviewDocumentID,
				Title:    "项目概览",
				Category: "overview",
				Content:  "# 项目概览",
			},
		},
		{
			name: "empty category",
			document: &AgentDocumentContext{
				ID:      "doc-1",
				Title:   "普通文档",
				Content: "# 普通文档",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prompt := BuildACPPrompt(AgentRunRequest{
				ProjectID: "project-1",
				Document:  test.document,
			}, PromptBuildOptions{})

			assertNoInlineCategoryGuidance(t, prompt)
		})
	}
}

func assertNoInlineCategoryGuidance(t *testing.T, prompt string) {
	t.Helper()
	for _, heading := range []string{
		"# 类型专属写作指导：剧本（screenplay）",
		"# 类型专属写作指导：角色档案（character）",
		"# 类型专属写作指导：场景设定（scene）",
		"# 类型专属写作指导：道具设定（prop）",
		"# 类型专属写作指导：分镜（storyboard）",
	} {
		if strings.Contains(prompt, heading) {
			t.Fatalf("prompt = %q, should not contain inline category guidance %q", prompt, heading)
		}
	}
}

func assertNoInlineToolUsageCatalog(t *testing.T, prompt string) {
	t.Helper()
	for _, toolName := range []string{
		"list_documents",
		"batch_get_documents",
		"get_document",
		"get_document_outline",
		"get_document_block",
		"get_document_section",
		"create_document",
		"stream_block_edit",
		"batch_document_edit",
		"document_patch_edit",
		"insert_block",
		"update_block",
		"replace_section",
		"replace_selection",
		"annotate_selection",
		"set_document_title",
		"set_document_category",
		"set_document_parent",
		"set_document_tags",
	} {
		if strings.Contains(prompt, toolName) {
			t.Fatalf("prompt = %q, should not inline tool usage for %q", prompt, toolName)
		}
	}
}
