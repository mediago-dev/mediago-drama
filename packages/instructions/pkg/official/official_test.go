package official

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestInstructionsParsesOfficialTemplates(t *testing.T) {
	instructions, err := Instructions(context.Background())
	if err != nil {
		t.Fatalf("Instructions() error = %v", err)
	}
	if len(instructions) != 3 {
		t.Fatalf("instructions = %#v, want AGENTS, TOOLS, and DOCUMENT_RULES", instructions)
	}
	if instructions[0].ID != "AGENTS" || instructions[1].ID != "TOOLS" || instructions[2].ID != "DOCUMENT_RULES" {
		t.Fatalf("instructions = %#v, want AGENTS, TOOLS, DOCUMENT_RULES", instructions)
	}
	for _, instruction := range instructions {
		if instruction.Name == "" || instruction.Body == "" {
			t.Fatalf("instruction = %#v, want name and body", instruction)
		}
		if instruction.ID == "DOCUMENT_RULES" && instruction.Editable {
			t.Fatalf("DOCUMENT_RULES = %#v, want non-editable", instruction)
		}
		if instruction.ID != "DOCUMENT_RULES" && !instruction.Editable {
			t.Fatalf("instruction = %#v, want editable", instruction)
		}
	}
}

func TestInstructionByIDReportsMissingInstruction(t *testing.T) {
	_, err := InstructionByID(context.Background(), "MISSING")
	if !errors.Is(err, ErrInstructionNotFound) {
		t.Fatalf("InstructionByID() error = %v, want ErrInstructionNotFound", err)
	}
}

func TestOfficialInternalTemplatesDoNotContainTemplateVariables(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "AGENTS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "AGENTS", err)
	}
	internal, ok := ExtractMarkdownSection(instruction.Body, "内部模板（代码读取）")
	if !ok {
		t.Fatal("AGENTS internal template section missing")
	}
	if strings.Contains(internal, "{{") || strings.Contains(internal, "}}") {
		t.Fatalf("AGENTS internal templates contain template variables:\n%s", internal)
	}
}

func TestPromptOptimizationIsNotOfficialInstruction(t *testing.T) {
	_, err := InstructionByID(context.Background(), "PROMPT_OPTIMIZATION")
	if !errors.Is(err, ErrInstructionNotFound) {
		t.Fatalf("InstructionByID(%q) error = %v, want ErrInstructionNotFound", "PROMPT_OPTIMIZATION", err)
	}
}

func TestToolsInstructionDoesNotBlockBusinessDocumentsOnMissingStyle(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}
	for _, want := range []string{
		"缺少视觉风格不得中断任务或先询问用户",
		"先生成风格中性的基础设定",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("TOOLS instruction = %q, want fragment %q", instruction.Body, want)
		}
	}
}

func TestToolsInstructionDelegatesImageWorkflowToSkill(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}

	for _, want := range []string{
		"生成、修改或重绘图片前，必须先调用 MCP `load_skill` 装载 `image-generation`",
		"图片专属的参数确认、参考图与异步提交流程以该 Skill 为准",
		"图片或视频生成请求成功提交并取得任务 ID 后，当前 Agent run 的职责立即结束",
		"不要在同一个 run 中等待图片或视频生成完成",
		"不得展示结果选片卡，也不得把生成结果回写到文档",
		"后台服务会继续执行任务、同步状态、落库结果并发送完成通知",
		"后续任务状态、重试和选片由生成工作台承接",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("TOOLS instruction = %q, want image skill trigger %q", instruction.Body, want)
		}
	}
	for _, forbidden := range []string{
		"### 生图标准流程",
		"select_generation_asset(taskId, slotIndex)",
		"用该 id 调 `poll_generation_task` 直到完成",
		"汇总查询后继续按 taskId 轮询",
		"最终回复只给结果：定稿资产名、图片地址、落库位置",
	} {
		if strings.Contains(instruction.Body, forbidden) {
			t.Fatalf("TOOLS instruction should delegate image detail %q to Skill:\n%s", forbidden, instruction.Body)
		}
	}
}

func TestToolsInstructionDelegatesVideoWorkflowToSkill(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}

	for _, want := range []string{
		"生成、修改或衔接视频前，必须先调用 MCP `load_skill` 装载 `video-generation`",
		"视频专属的模型选择、首帧参考、时长与分辨率参数和异步提交流程以该 Skill 为准",
		"图片或视频生成请求成功提交并取得任务 ID 后，当前 Agent run 的职责立即结束",
		"不要在同一个 run 中等待图片或视频生成完成",
		"不得展示结果选片卡，也不得把生成结果回写到文档",
		"后台服务会继续执行任务、同步状态、落库结果并发送完成通知",
		"后续任务状态、重试和选片由生成工作台承接",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("TOOLS instruction = %q, want video skill trigger %q", instruction.Body, want)
		}
	}
	for _, forbidden := range []string{
		"### 视频生成标准流程",
		"select_generation_asset(taskId, slotIndex)",
		"后台异步轮询与文档回写流程以该 Skill 为准",
	} {
		if strings.Contains(instruction.Body, forbidden) {
			t.Fatalf("TOOLS instruction should delegate video detail %q to Skill:\n%s", forbidden, instruction.Body)
		}
	}
}

func TestToolsInstructionDefinesUnifiedGenerationPlanContract(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}
	for _, want := range []string{
		"Generation MCP 只提供 `generate_media` 和 `generate_media_batch`",
		"kind: \"generation_plan\"",
		"图片与视频表单都必须恰好包含一个 required",
		"kind: \"image\"",
		"kind: \"video\"",
		"`generation_settings` 表单会通过实时 HTTP 目录自行加载",
		"不得混入 `generation_params`、`images`",
		"routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization",
		"与批量生成设置同源",
		"`confirmationSelectionId`",
		"`routeId`/`params`",
		"参考图、补充提示词和提示词优化与用户确认值一致",
		"传输心跳",
		"对同一 `selectionId` 持续等待",
		"等待期间不得调用其他工具、不得生成、不得结束回合或发送最终答复",
		"只有 `generation_plan` 状态明确为 `submitted` 才能继续生成",
		"pending/timeout",
		"关闭弹窗",
		"cancelled 或 expired",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("TOOLS instruction = %q, want selection contract %q", instruction.Body, want)
		}
	}
	if strings.Contains(instruction.Body, "循环 3-5 轮") {
		t.Fatalf("TOOLS instruction must not cap selection waiting: %q", instruction.Body)
	}
}

func TestToolsInstructionDoesNotExposeRemovedGenerationToolsOrRetryProtocol(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}

	for _, forbidden := range []string{
		"list_generation_models",
		"get_generation_task",
		"list_generation_tasks",
		"retry_generation_task",
		"poll_generation_task",
		"select_generation_asset",
		"generation_retry_plan",
		"confirm_retry",
		"retryTaskId",
	} {
		if strings.Contains(instruction.Body, forbidden) {
			t.Fatalf("TOOLS instruction contains removed generation contract %q:\n%s", forbidden, instruction.Body)
		}
	}
}

func TestDocumentRulesInstructionDefinesSecondLevelResourceBoundary(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "DOCUMENT_RULES")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "DOCUMENT_RULES", err)
	}
	for _, want := range []string{
		"业务文档的主体资源边界是二级标题",
		"没有二级标题的内容不会被识别为独立业务资源",
		"逐项检查所有主体资源是否都有对应的二级标题",
		"只修正标题层级和必要的标题文字",
		"不得借机重写、删减或调整正文顺序",
		"不要删除、伪造或批量改写已有 `section-id`",
		"文档写作 Skill 只提供业务写作方法",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("DOCUMENT_RULES instruction = %q, want fragment %q", instruction.Body, want)
		}
	}
	if instruction.Editable {
		t.Fatalf("DOCUMENT_RULES = %#v, want non-editable", instruction)
	}
	if !instruction.Injectable {
		t.Fatalf("DOCUMENT_RULES = %#v, want injectable", instruction)
	}
}

func TestExtractMarkdownSectionFindsNestedHeading(t *testing.T) {
	markdown := `# Root

intro

## Parent

parent intro

### Child

child body

### Sibling

sibling body

## Next

next body`
	section, ok := ExtractMarkdownSection(markdown, "Parent", "Child")
	if !ok {
		t.Fatal("ExtractMarkdownSection() ok = false")
	}
	if section != "child body" {
		t.Fatalf("section = %q, want child body", section)
	}
}

func TestExtractMarkdownSectionAllowsEscapedTemplateHeadings(t *testing.T) {
	markdown := `## Internal

### Template

{{"#"}} Prompt Title

{{"##"}} Prompt Fields

body

### Next

next body`
	section, ok := ExtractMarkdownSection(markdown, "Internal", "Template")
	if !ok {
		t.Fatal("ExtractMarkdownSection() ok = false")
	}
	if !strings.Contains(section, `{{"#"}} Prompt Title`) || !strings.Contains(section, "body") {
		t.Fatalf("section = %q, want escaped template headings retained", section)
	}
	if strings.Contains(section, "next body") {
		t.Fatalf("section = %q, want next sibling excluded", section)
	}
}

func TestRemoveMarkdownSectionRemovesNestedHeading(t *testing.T) {
	markdown := `# Root

intro

## Keep

keep body

## Internal

hidden body

### Hidden Child

child body`
	cleaned := RemoveMarkdownSection(markdown, "Internal")
	if strings.Contains(cleaned, "hidden body") || strings.Contains(cleaned, "Hidden Child") {
		t.Fatalf("cleaned = %q, want internal section removed", cleaned)
	}
	if !strings.Contains(cleaned, "keep body") {
		t.Fatalf("cleaned = %q, want keep body retained", cleaned)
	}
}
