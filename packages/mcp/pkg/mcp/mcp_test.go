package mcp

import (
	"strings"
	"testing"
)

func TestToolName(t *testing.T) {
	if got := ToolName("get_document"); got != "mediago_drama/get_document" {
		t.Fatalf("ToolName() = %q, want mediago_drama/get_document", got)
	}
}

func TestDocumentHTTPURL(t *testing.T) {
	got, ok := DocumentHTTPURL(DocumentHTTPURLConfig{
		BridgeURL:        " https://example.test/base ",
		ProjectID:        "project-1",
		SessionID:        "session-1",
		RunID:            "run-1",
		AgentTag:         "MediaGo Drama Agent",
		ActiveDocumentID: "doc-1",
		SelectionText:    "selected",
	})
	if !ok {
		t.Fatal("DocumentHTTPURL returned ok=false")
	}
	for _, fragment := range []string{
		"https://example.test/api/v1/internal/agent/document-mcp?",
		"projectId=project-1",
		"sessionId=session-1",
		"agentTag=MediaGo+Drama+Agent",
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("url = %q, want fragment %q", got, fragment)
		}
	}
	if strings.Contains(got, "roleId=") {
		t.Fatalf("url = %q, should not include roleId", got)
	}
}

func TestDocumentHTTPURLRejectsInvalidBridgeURL(t *testing.T) {
	if got, ok := DocumentHTTPURL(DocumentHTTPURLConfig{BridgeURL: "://bad"}); ok || got != "" {
		t.Fatalf("DocumentHTTPURL() = %q, %t; want empty URL and ok=false", got, ok)
	}
}

func TestGenerationHTTPURLIncludesConfirmationScope(t *testing.T) {
	got, ok := GenerationHTTPURL(GenerationHTTPURLConfig{
		BridgeURL: "https://example.test/base",
		ProjectID: "project-1",
		SessionID: "session-1",
		RunID:     "run-1",
		AgentTag:  "MediaGo Drama Agent",
	})
	if !ok {
		t.Fatal("GenerationHTTPURL returned ok=false")
	}
	for _, fragment := range []string{
		"/api/v1/internal/agent/generation-mcp?",
		"projectId=project-1",
		"sessionId=session-1",
		"runId=run-1",
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("url = %q, want fragment %q", got, fragment)
		}
	}
}

func TestDocumentStdioEnvUsesFixedAgentConfig(t *testing.T) {
	env := DocumentStdioEnv(DocumentLaunchConfig{
		SessionID:   "session-1",
		RunID:       "run-1",
		RolePersona: "固定 Agent",
		AgentTag:    "MediaGo Drama Agent",
	})
	values := map[string]string{}
	for _, item := range env {
		values[item.Name] = item.Value
	}
	if values[envAgentSessionID] != "session-1" ||
		values[envAgentRunID] != "run-1" ||
		values[envAgentTag] != "MediaGo Drama Agent" ||
		values[envRolePersona] != "固定 Agent" {
		t.Fatalf("env = %#v, want fixed agent launch config", values)
	}
	if _, ok := values["MEDIAGO_DRAMA_AGENT_ROLE_ID"]; ok {
		t.Fatalf("env = %#v, should not include role id", values)
	}
	if _, ok := values["MEDIAGO_DRAMA_ROLE_NAME"]; ok {
		t.Fatalf("env = %#v, should not include role name", values)
	}
}

func TestDocumentConfigFromEnvVars(t *testing.T) {
	values := map[string]string{
		envAgentSessionID: " session-1 ",
		envAgentRunID:     " run-1 ",
		envAgentTag:       " MediaGo Drama Agent ",
	}
	config := DocumentConfigFromEnvVars(func(name string) string {
		return values[name]
	})

	if config.SessionID != "session-1" ||
		config.RunID != "run-1" ||
		config.AgentTag != "MediaGo Drama Agent" {
		t.Fatalf("config = %#v, want trimmed fixed agent config", config)
	}
}

func TestDocumentConfigFromEnvVarsAcceptsLegacyMediaCLIEnv(t *testing.T) {
	values := map[string]string{
		legacyEnvAgentSessionID: " legacy-session ",
		legacyEnvAgentRunID:     " legacy-run ",
		legacyEnvAgentTag:       " Legacy Agent ",
	}
	config := DocumentConfigFromEnvVars(func(name string) string {
		return values[name]
	})

	if config.SessionID != "legacy-session" ||
		config.RunID != "legacy-run" ||
		config.AgentTag != "Legacy Agent" {
		t.Fatalf("config = %#v, want trimmed legacy env config", config)
	}
}

func TestDocumentToolDefinitions(t *testing.T) {
	if !strings.Contains(AgentMCPInstructions, "当前工作目录") ||
		!strings.Contains(AgentMCPInstructions, "不要再访问或创建名为 work/ 的子目录") ||
		!strings.Contains(AgentMCPInstructions, "load_skill") ||
		!strings.Contains(AgentMCPInstructions, "get_project_config") ||
		!strings.Contains(AgentMCPInstructions, "项目配置不再承载视觉风格") ||
		!strings.Contains(AgentMCPInstructions, "update_project_config") ||
		!strings.Contains(AgentMCPInstructions, "mutate_comment") {
		t.Fatalf("AgentMCPInstructions should explain file-native MCP boundary: %q", AgentMCPInstructions)
	}
	if strings.Contains(AgentMCPInstructions, "get_guidelines") {
		t.Fatalf("AgentMCPInstructions should not mention get_guidelines: %q", AgentMCPInstructions)
	}
	if AgentDocumentTools.LoadSkill.Name != "load_skill" || !AgentDocumentTools.LoadSkill.ReadOnly {
		t.Fatalf("LoadSkill definition = %#v", AgentDocumentTools.LoadSkill)
	}
	if !strings.Contains(AgentDocumentTools.LoadSkill.Description, "当前工作目录") ||
		!strings.Contains(AgentDocumentTools.LoadSkill.Description, "不要再访问 work/ 子目录") {
		t.Fatalf("LoadSkill description should include MCP boundary: %q", AgentDocumentTools.LoadSkill.Description)
	}
	if AgentDocumentTools.GetProjectConfig.Name != "get_project_config" ||
		!AgentDocumentTools.GetProjectConfig.ReadOnly ||
		!strings.Contains(AgentDocumentTools.GetProjectConfig.Description, "提示词分类默认预设") ||
		!strings.Contains(AgentDocumentTools.GetProjectConfig.Description, "不再承载视觉风格") ||
		!strings.Contains(AgentDocumentTools.GetProjectConfig.Description, "不要搜索") {
		t.Fatalf("GetProjectConfig definition = %#v", AgentDocumentTools.GetProjectConfig)
	}
	if AgentDocumentTools.UpdateProjectConfig.Name != "update_project_config" ||
		!strings.Contains(AgentDocumentTools.UpdateProjectConfig.Description, "overview.categoryDefaults") ||
		!strings.Contains(AgentDocumentTools.UpdateProjectConfig.Description, "style 风格分类会被忽略") {
		t.Fatalf("UpdateProjectConfig definition = %#v", AgentDocumentTools.UpdateProjectConfig)
	}
	if AgentDocumentTools.ListComments.Name != "list_comments" || !AgentDocumentTools.ListComments.ReadOnly {
		t.Fatalf("ListComments definition = %#v", AgentDocumentTools.ListComments)
	}
	if AgentDocumentTools.GetComment.Name != "get_comment" || !AgentDocumentTools.GetComment.ReadOnly {
		t.Fatalf("GetComment definition = %#v", AgentDocumentTools.GetComment)
	}
	if AgentDocumentTools.MutateComment.Name != "mutate_comment" ||
		!strings.Contains(AgentDocumentTools.MutateComment.Description, "add、update、reply、resolve、unresolve、delete") {
		t.Fatalf("MutateComment definition = %#v", AgentDocumentTools.MutateComment)
	}
	for _, fragment := range []string{
		"kind=generation_plan",
		"generation_settings(kind=image)",
		"generation_params(kind=video)",
		"timeout 只表示一次 MCP 传输等待结束",
		"不设轮数上限",
		"不得调用其他工具",
	} {
		if !strings.Contains(AgentMCPInstructions, fragment) {
			t.Fatalf("AgentMCPInstructions missing form/wait contract %q: %q", fragment, AgentMCPInstructions)
		}
	}
	if strings.Contains(AgentMCPInstructions, "3-5") {
		t.Fatalf("AgentMCPInstructions must not cap selection waiting: %q", AgentMCPInstructions)
	}
	if !strings.Contains(AgentDocumentTools.AskUserForm.Description, "不得与 generation_params") ||
		!strings.Contains(AgentDocumentTools.AskUserForm.Description, "generation_settings(kind=image)") ||
		!strings.Contains(AgentDocumentTools.AskUserForm.Description, "timeout 只是传输心跳") {
		t.Fatalf("AskUserForm description = %q, want generation plan and timeout contracts", AgentDocumentTools.AskUserForm.Description)
	}
	if !strings.Contains(AgentDocumentTools.AwaitUserSelection.Description, "不设轮数上限") ||
		!strings.Contains(AgentDocumentTools.AwaitUserSelection.Description, "不得调用其他工具") {
		t.Fatalf("AwaitUserSelection description = %q, want continuous wait contract", AgentDocumentTools.AwaitUserSelection.Description)
	}
	if ExternalDocumentTools.ListProjects.Name != "list_projects" || !ExternalDocumentTools.ListProjects.ReadOnly {
		t.Fatalf("ListProjects definition = %#v", ExternalDocumentTools.ListProjects)
	}
}

func TestMCPInstructionsKeepGenerationContractsWithoutImageWorkflow(t *testing.T) {
	for _, fragment := range []string{
		"list_generation_models",
		"generate_media",
		"generate_media_batch",
		"referenceAssetIds",
		"documentContext",
		"notificationTarget",
		"confirmationSelectionId",
		"poll_generation_task",
		"select_generation_asset",
	} {
		if !strings.Contains(GenerationMCPInstructions, fragment) {
			t.Fatalf("GenerationMCPInstructions missing contract %q: %q", fragment, GenerationMCPInstructions)
		}
	}
	for _, fragment := range []string{
		"目标资源有歧义",
		"需要形象一致",
		"参数表单",
		"用户确认某个 preset",
		"一次生成返回多张结果",
	} {
		if strings.Contains(GenerationMCPInstructions, fragment) {
			t.Fatalf("GenerationMCPInstructions should delegate image workflow %q to Skill: %q", fragment, GenerationMCPInstructions)
		}
	}
	for _, fragment := range []string{
		"生图前用它确认风格或结果选片",
		"生图参数确认用单个 generation_params",
	} {
		if strings.Contains(AgentMCPInstructions, fragment) {
			t.Fatalf("AgentMCPInstructions should expose generic selection contracts instead of image workflow %q: %q", fragment, AgentMCPInstructions)
		}
	}
}

func TestGenerationInstructionsDoNotAdvertiseStandaloneStylePresets(t *testing.T) {
	for name, value := range map[string]string{
		"GenerationMCPInstructions":           GenerationMCPInstructions,
		"GenerationTools.ListModels":          GenerationTools.ListModels.Description,
		"AgentDocumentTools.AskUserSelection": AgentDocumentTools.AskUserSelection.Description,
	} {
		for _, fragment := range []string{"stylePresets", "promptSuffix", "风格推荐网格"} {
			if strings.Contains(value, fragment) {
				t.Fatalf("%s should not advertise standalone style workflow %q: %q", name, fragment, value)
			}
		}
	}
	if !strings.Contains(GenerationMCPInstructions, "统一生成设置表单中的动态提示词包") {
		t.Fatalf("GenerationMCPInstructions should point to dynamic prompt packs: %q", GenerationMCPInstructions)
	}
	if !strings.Contains(GenerationTools.ListModels.Description, "动态提示词包") {
		t.Fatalf("ListModels description should point to dynamic prompt packs: %q", GenerationTools.ListModels.Description)
	}
	for name, value := range map[string]string{
		"GenerationMCPInstructions":     GenerationMCPInstructions,
		"GenerationTools.Generate":      GenerationTools.Generate.Description,
		"GenerationTools.GenerateBatch": GenerationTools.GenerateBatch.Description,
	} {
		if !strings.Contains(value, "promptSupplements") {
			t.Fatalf("%s should state that confirmation validates promptSupplements: %q", name, value)
		}
	}
}
