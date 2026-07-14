package builtin

import (
	"context"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

func TestBuiltinPackParses(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}
	counts := map[pack.Kind]int{}
	for _, entry := range bundle.Entries {
		counts[entry.Kind]++
	}
	if bundle.Manifest.ID != "builtin" ||
		counts[pack.KindSkill] != 9 ||
		counts[pack.KindPrompt] != 10 {
		t.Fatalf("builtin manifest=%#v counts=%#v", bundle.Manifest, counts)
	}
	foundNovelWriter := false
	foundAutoMentionResolver := false
	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill {
			continue
		}
		if entry.Slug == "auto-mention-resolver" {
			foundAutoMentionResolver = true
			continue
		}
		if entry.Slug == "image-generation" || entry.Slug == "video-generation" {
			if hidden, _ := entry.Metadata["hidden"].(bool); hidden {
				t.Fatalf("%s hidden = %#v, want visible so load_skill can resolve it", entry.Slug, entry.Metadata["hidden"])
			}
			continue
		}
		hint, ok := entry.Metadata["hint"].(map[string]string)
		if !ok || hint["document_category"] == "" {
			t.Fatalf("%s hint = %#v, want document category", entry.Slug, entry.Metadata["hint"])
		}
		if entry.Metadata["template_id"] != "" {
			t.Fatalf("%s template_id = %#v, want empty because core rules live in system prompt", entry.Slug, entry.Metadata["template_id"])
		}
		if entry.Slug == "novel-writer" {
			foundNovelWriter = true
			if hint["document_category"] != "reference" {
				t.Fatalf("novel-writer hint = %#v, want reference document category", entry.Metadata["hint"])
			}
		}
	}
	if !foundNovelWriter {
		t.Fatal("builtin skills missing novel-writer")
	}
	if !foundAutoMentionResolver {
		t.Fatal("builtin skills missing auto-mention-resolver")
	}
}

func TestImageGenerationSkillOwnsAgentImageWorkflow(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill || entry.Slug != "image-generation" {
			continue
		}

		body := entry.Description + "\n" + entry.Body
		for _, fragment := range []string{
			"list_generation_models",
			"kind: \"image\"",
			"ask_user_selection",
			"ask_user_form",
			"直接调用一次 `ask_user_form` 打开统一生成设置表单",
			"不要在模型目录之后单独展示通用“风格选择”卡",
			"用户可维护的动态提示词包",
			"名为 `style` 的参数",
			"type: \"generation_settings\"",
			"required: true",
			"kind: \"image\"",
			"kind: \"generation_plan\"",
			"恰好一个 required `generation_settings`",
			"不得再添加 `generation_params`、`images`、`prompt_optimization`",
			"routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization",
			"`default` 可省略",
			"没有本轮明确 override 时，不要传 `default`",
			"与批量生成弹窗相同的本地保存状态和偏好恢复",
			"一旦提供，必须是完整设置对象",
			"传输心跳",
			"只有状态明确为 `submitted`",
			"pending/timeout",
			"关闭弹窗",
			"用户已经明确比例、分辨率或张数",
			"referenceAssetIds",
			"promptSupplements",
			"promptOptimization",
			"generate_media",
			"generate_media_batch",
			"list_generation_tasks(batchId: ...)",
			"documentContext",
			"notificationTarget",
			"confirmationSelectionId",
			"poll_generation_task",
			"select_generation_asset",
			"slotIndex",
		} {
			if !strings.Contains(body, fragment) {
				t.Fatalf("image-generation missing workflow rule %q:\n%s", fragment, body)
			}
		}
		for _, fragment := range []string{
			"stylePresets",
			"promptSuffix",
			"获取模型目录并确定风格",
			"用户选定 preset",
			"恰好一个 `generation_params`",
			"从 `values.generation` 原样取得 `{routeId, label, params}`",
			"`default` 必须是完整设置对象",
		} {
			if strings.Contains(body, fragment) {
				t.Fatalf("image-generation should not use standalone style workflow %q:\n%s", fragment, body)
			}
		}
		if hint, ok := entry.Metadata["hint"].(map[string]string); !ok || len(hint) != 0 {
			t.Fatalf("image-generation hint = %#v, want no document category restriction", entry.Metadata["hint"])
		}
		return
	}

	t.Fatal("builtin skills missing image-generation")
}

func TestVideoGenerationSkillOwnsAgentVideoWorkflow(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill || entry.Slug != "video-generation" {
			continue
		}

		body := entry.Description + "\n" + entry.Body
		for _, fragment := range []string{
			"list_generation_models",
			"kind: \"video\"",
			"不要在模型目录之后单独展示通用“风格选择”卡",
			"用户可维护的动态提示词包",
			"名为 `style` 的参数",
			"首帧",
			"后台异步",
			"ask_user_selection",
			"ask_user_form",
			"generation_params",
			"required: true",
			"本轮视频继续使用旧复合字段协议",
			"不得改用 `generation_settings`",
			"kind: \"generation_plan\"",
			"恰好一个",
			"不要添加 `select`、`toggle`、`number`、`text`",
			"传输心跳",
			"不得调用其他工具",
			"prompt_optimization",
			"referenceAssetIds",
			"generate_media",
			"generate_media_batch",
			"list_generation_tasks(batchId: ...)",
			"documentContext",
			"notificationTarget",
			"confirmationSelectionId",
			"poll_generation_task",
			"retry_generation_task",
			"select_generation_asset",
			"slotIndex",
			"returnLastFrame",
			"为分镜批量生成视频",
			"第 0N 组",
			"先试片",
			"组号",
		} {
			if !strings.Contains(body, fragment) {
				t.Fatalf("video-generation missing workflow rule %q:\n%s", fragment, body)
			}
		}
		if strings.Contains(body, "stylePresets") {
			t.Fatalf("video-generation should not depend on standalone style presets:\n%s", body)
		}
		if hint, ok := entry.Metadata["hint"].(map[string]string); !ok || len(hint) != 0 {
			t.Fatalf("video-generation hint = %#v, want no document category restriction", entry.Metadata["hint"])
		}
		return
	}

	t.Fatal("builtin skills missing video-generation")
}

func TestCharacterWriterSplitsVisualVariants(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill || entry.Slug != "character-writer" {
			continue
		}

		body := entry.Description + "\n" + entry.Body
		for _, fragment := range []string{"时期/形态拆分", "aaa（十年前）", "aaa（十年后）", "aaa（变身前）", "aaa（变身后）"} {
			if !strings.Contains(body, fragment) {
				t.Fatalf("character-writer missing visual variant rule %q:\n%s", fragment, body)
			}
		}
		return
	}

	t.Fatal("builtin skills missing character-writer")
}

func TestBuiltinCreativeSkillsDoNotBlockOnMissingVisualStyle(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	creativeSkillSlugs := map[string]bool{
		"character-writer": true,
		"scene-writer":     true,
		"prop-writer":      true,
	}
	blockingFragments := []string{
		"先定风格",
		"config.overview.style",
		"项目所选视觉风格",
		"项目视觉风格未设定",
		"先询问用户确认风格",
		"必须先在 Agent 面板直接询问用户",
		"不要在用户确认风格前继续",
	}
	found := map[string]bool{}
	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill || !creativeSkillSlugs[entry.Slug] {
			continue
		}
		found[entry.Slug] = true
		body := entry.Description + "\n" + entry.Body
		if !strings.Contains(body, "风格中性") {
			t.Fatalf("%s body should instruct neutral style fallback:\n%s", entry.Slug, body)
		}
		for _, fragment := range blockingFragments {
			if strings.Contains(body, fragment) {
				t.Fatalf("%s body contains blocking style fragment %q:\n%s", entry.Slug, fragment, body)
			}
		}
	}
	for slug := range creativeSkillSlugs {
		if !found[slug] {
			t.Fatalf("builtin skills missing %s", slug)
		}
	}
}

func TestAutoMentionResolverOwnsAutomaticMentionRules(t *testing.T) {
	bundle, err := Builtin(context.Background())
	if err != nil {
		t.Fatalf("Builtin() error = %v", err)
	}

	var autoMentionBody string
	var storyboardBody string
	for _, entry := range bundle.Entries {
		if entry.Kind != pack.KindSkill {
			continue
		}
		switch entry.Slug {
		case "auto-mention-resolver":
			autoMentionBody = entry.Description + "\n" + entry.Body
		case "storyboard-writer":
			storyboardBody = entry.Description + "\n" + entry.Body
		}
	}

	for _, fragment := range []string{
		"不要求字面精确匹配",
		"场景资源和角色资源同等优先",
		"地点名、空间名、室内外环境、场次标题、镜头发生地、动作发生地",
		"场景标题、动作描写、镜头环境描述是场景自动 @ 的高优先级位置",
		"保留正文原词并复制索引里的完整链接",
		"原文实体名 + 紧跟 @ 链接",
		"资源类别｜资源标题｜完整 Markdown @ 链接",
		"mention://<document-id>/<block-id>",
		"稳定章节 ID 可能来自文档里的 `<!-- section-id: ... -->`",
		"你不需要、也不应该计算这些 ID",
		"不要自己拼接或编造 `mention://`、`asset://`",
	} {
		if !strings.Contains(autoMentionBody, fragment) {
			t.Fatalf("auto-mention-resolver missing rule %q:\n%s", fragment, autoMentionBody)
		}
		if strings.Contains(storyboardBody, fragment) {
			t.Fatalf("storyboard-writer should not contain automatic mention rule %q:\n%s", fragment, storyboardBody)
		}
	}
	for _, fragment := range []string{
		"自动 @ 引用",
		"# 可用 @ 资源索引",
		"auto-mention-resolver",
	} {
		if strings.Contains(storyboardBody, fragment) {
			t.Fatalf("storyboard-writer should not contain automatic mention parsing fragment %q:\n%s", fragment, storyboardBody)
		}
	}
}
