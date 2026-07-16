package acp

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "acp-tests-*")
	if err != nil {
		panic(err)
	}
	repos, err := repository.OpenSettingsRepositories(filepath.Join(dir, "settings.sqlite"))
	if err != nil {
		panic(err)
	}
	store := promptpack.NewServiceFromRepository(repos.Packs, repos.PromptLibrary, nil)
	serviceprompt.SetPromptTemplateStore(prompttemplates.NewServiceFromRepository(repos.Instructions, nil))
	serviceskill.SetPromptPackStore(store)
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

func TestParseACPFinalResponseWithTrailingDocumentProposal(t *testing.T) {
	response := ParseACPFinalResponse(
		"Updated the draft opening.\n```json\n{\"proposedDocument\":{\"content\":\"# Draft\\n\"}}\n```",
		agentRunRequest{Document: &agentDocumentContext{ID: "doc-1"}},
	)

	if response.Message != "Updated the draft opening." {
		t.Fatalf("message = %q, want explanation", response.Message)
	}
	if response.ProposedDocument == nil {
		t.Fatal("expected proposed document")
	}
	if response.ProposedDocument.DocumentID != "doc-1" {
		t.Fatalf("documentId = %q, want doc-1", response.ProposedDocument.DocumentID)
	}
	if response.ProposedDocument.Content != "# Draft\n" {
		t.Fatalf("content = %q, want markdown", response.ProposedDocument.Content)
	}
}

func TestParseACPFinalResponseIgnoresEarlierBraces(t *testing.T) {
	response := ParseACPFinalResponse(
		"Keep the {placeholder} marker in prose.\n{\"message\":\"done\",\"proposedDocument\":{\"content\":\"# Draft\\n\"}}",
		agentRunRequest{Document: &agentDocumentContext{ID: "doc-2"}},
	)

	if response.Message != "done" {
		t.Fatalf("message = %q, want done", response.Message)
	}
	if response.ProposedDocument == nil || response.ProposedDocument.DocumentID != "doc-2" {
		t.Fatalf("proposal = %#v, want doc-2", response.ProposedDocument)
	}
}

func TestParseACPFinalResponseWithA2UI(t *testing.T) {
	response := ParseACPFinalResponse(
		"请选择处理方式。\n{\"a2ui\":{\"version\":\"v0.9\",\"surfaceId\":\"attachment\",\"messages\":[{\"version\":\"v0.9\",\"createSurface\":{\"surfaceId\":\"attachment\",\"catalogId\":\"basic\"}}]}}",
		agentRunRequest{},
	)

	if response.Message != "请选择处理方式。" {
		t.Fatalf("message = %q, want prefix", response.Message)
	}
	if response.A2UI == nil {
		t.Fatal("expected A2UI payload")
	}
	if response.A2UI.Version != "v0.9" {
		t.Fatalf("A2UI version = %q, want v0.9", response.A2UI.Version)
	}
	if response.A2UI.SurfaceID != "attachment" {
		t.Fatalf("A2UI surface = %q, want attachment", response.A2UI.SurfaceID)
	}
	var messages []map[string]any
	if err := json.Unmarshal(response.A2UI.Messages, &messages); err != nil {
		t.Fatalf("A2UI messages invalid json: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("A2UI messages = %d, want 1", len(messages))
	}
}

func TestParseACPFinalResponseEmptyHasNoLegacyFallback(t *testing.T) {
	response := ParseACPFinalResponse("   ", agentRunRequest{})
	if response.Message != "" {
		t.Fatalf("message = %q, want empty message", response.Message)
	}
}

func TestParseACPFinalResponseForItemKeepsStructuredPayloadButUsesFinalItemText(t *testing.T) {
	response := parseACPFinalResponseForItem(
		"正在读取文档。\n{\"proposedDocument\":{\"content\":\"# Draft\\n\"}}\n文档已更新。",
		"文档已更新。",
		agentRunRequest{Document: &agentDocumentContext{ID: "doc-1"}},
	)

	if response.Message != "文档已更新。" {
		t.Fatalf("message = %q, want final item text only", response.Message)
	}
	if response.ProposedDocument == nil || response.ProposedDocument.DocumentID != "doc-1" || response.ProposedDocument.Content != "# Draft\n" {
		t.Fatalf("proposal = %#v, want structured payload retained from full response", response.ProposedDocument)
	}
}

func TestACPClientWorkspacePath(t *testing.T) {
	root := t.TempDir()
	client := &acpClient{workspaceDir: root}

	inside, err := client.workspacePath(filepath.Join(root, "projects", "demo.md"))
	if err != nil {
		t.Fatalf("workspacePath inside returned error: %v", err)
	}
	if inside != filepath.Join(root, "projects", "demo.md") {
		t.Fatalf("inside = %q, want path inside workspace", inside)
	}

	if _, err := client.workspacePath(filepath.Dir(root)); err == nil {
		t.Fatal("workspacePath outside returned nil error")
	}
}

func TestACPAgentRunnerAbsoluteRunDirPrefersWorkingDir(t *testing.T) {
	workspaceDir := t.TempDir()
	projectDir := filepath.Join(t.TempDir(), "project")
	workingDir := filepath.Join(projectDir, "work")
	runner := &acpAgentRunner{workspaceDir: workspaceDir}

	runDir := runner.absoluteRunDir(agentRunRequest{
		WorkspaceDir: workspaceDir,
		ProjectDir:   projectDir,
		WorkingDir:   workingDir,
	})

	if runDir != filepath.Clean(workingDir) {
		t.Fatalf("runDir = %q, want working dir %q", runDir, filepath.Clean(workingDir))
	}
}

func TestACPAgentRunnerAbsoluteRunDirFallsBackToProjectDir(t *testing.T) {
	workspaceDir := t.TempDir()
	projectDir := filepath.Join(t.TempDir(), "project")
	runner := &acpAgentRunner{workspaceDir: workspaceDir}

	runDir := runner.absoluteRunDir(agentRunRequest{
		WorkspaceDir: workspaceDir,
		ProjectDir:   projectDir,
	})

	if runDir != filepath.Clean(projectDir) {
		t.Fatalf("runDir = %q, want project dir %q", runDir, filepath.Clean(projectDir))
	}
}

func TestACPAgentRunnerAbsoluteRunDirFallsBackToWorkspaceDir(t *testing.T) {
	workspaceDir := t.TempDir()
	runner := &acpAgentRunner{workspaceDir: filepath.Join(t.TempDir(), "other-workspace")}

	runDir := runner.absoluteRunDir(agentRunRequest{WorkspaceDir: workspaceDir})

	if runDir != filepath.Clean(workspaceDir) {
		t.Fatalf("runDir = %q, want workspace dir %q", runDir, filepath.Clean(workspaceDir))
	}
}

func TestACPAgentRunnerPrepareProcessConfigForManagedACPBackends(t *testing.T) {
	provider := &recordingProcessConfigProvider{
		config: ProcessConfig{
			ConfigDir:                  filepath.Join(t.TempDir(), "opencode-config"),
			Env:                        map[string]string{"MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY": "sk-test"},
			ProfileCount:               1,
			DefaultProfileID:           "minimax",
			NativeInstructionsInjected: true,
		},
	}
	runner := &acpAgentRunner{
		buildPrompt: func(AgentRunRequest) string {
			return "固定系统提示"
		},
		processConfigProvider: provider,
	}
	request := agentRunRequest{
		WorkspaceDir: "/workspace",
		ProjectID:    "project-1",
		ProjectDir:   "/workspace/project",
		WorkingDir:   "/workspace/project/work",
		Model: AgentACPConfigSelection{
			Value: "mediago/deepseek-v4-flash",
		},
	}

	config, err := runner.prepareProcessConfig(context.Background(), "/usr/local/bin/opencode", []string{"acp"}, request)
	if err != nil {
		t.Fatalf("prepareProcessConfig returned error: %v", err)
	}
	if len(provider.requests) != 1 {
		t.Fatalf("provider requests = %d, want 1", len(provider.requests))
	}
	if provider.requests[0].AgentID != "opencode" {
		t.Fatalf("agent id = %q, want opencode", provider.requests[0].AgentID)
	}
	if provider.requests[0].WorkingDir != request.WorkingDir || provider.requests[0].ProjectID != request.ProjectID {
		t.Fatalf("provider request = %#v, want run request fields", provider.requests[0])
	}
	if provider.requests[0].PreferredModel != "mediago/deepseek-v4-flash" {
		t.Fatalf("preferred model = %q, want selected runtime model", provider.requests[0].PreferredModel)
	}
	if provider.requests[0].FixedInstructions != "固定系统提示" {
		t.Fatalf("fixed instructions = %q, want rendered runtime instructions", provider.requests[0].FixedInstructions)
	}
	if !config.NativeInstructionsInjected {
		t.Fatal("NativeInstructionsInjected = false, want provider acknowledgement preserved")
	}
	if config.Env["OPENCODE_CONFIG_DIR"] != provider.config.ConfigDir {
		t.Fatalf("OPENCODE_CONFIG_DIR = %q, want %q", config.Env["OPENCODE_CONFIG_DIR"], provider.config.ConfigDir)
	}
	if config.Env["MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY"] != "sk-test" {
		t.Fatalf("profile key env = %q, want injected key", config.Env["MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY"])
	}

	codexConfig, err := runner.prepareProcessConfig(context.Background(), "codex-acp", nil, request)
	if err != nil {
		t.Fatalf("prepareProcessConfig codex returned error: %v", err)
	}
	if len(provider.requests) != 2 {
		t.Fatalf("provider requests after codex = %d, want 2", len(provider.requests))
	}
	if provider.requests[1].AgentID != "codex" {
		t.Fatalf("agent id = %q, want codex", provider.requests[1].AgentID)
	}
	if _, ok := codexConfig.Env["OPENCODE_CONFIG_DIR"]; ok {
		t.Fatalf("codex env should not include OPENCODE_CONFIG_DIR: %#v", codexConfig.Env)
	}

	if _, err := runner.prepareProcessConfig(context.Background(), "custom-acp", nil, request); err != nil {
		t.Fatalf("prepareProcessConfig custom returned error: %v", err)
	}
	if len(provider.requests) != 2 {
		t.Fatalf("provider requests after custom = %d, want unchanged", len(provider.requests))
	}
}

func TestACPAgentRunnerPrepareProcessConfigUsesPreRenderedInstructions(t *testing.T) {
	renderCount := 0
	provider := &recordingProcessConfigProvider{}
	runner := &acpAgentRunner{
		buildPrompt: func(AgentRunRequest) string {
			renderCount++
			return "unexpected second render"
		},
		processConfigProvider: provider,
	}

	if _, err := runner.prepareProcessConfig(
		context.Background(),
		"codex-acp",
		nil,
		agentRunRequest{},
		"pre-rendered instructions",
	); err != nil {
		t.Fatalf("prepareProcessConfig returned error: %v", err)
	}
	if renderCount != 0 {
		t.Fatalf("fixed instruction render count = %d, want 0 with pre-rendered override", renderCount)
	}
	if len(provider.requests) != 1 || provider.requests[0].FixedInstructions != "pre-rendered instructions" {
		t.Fatalf("provider requests = %#v, want pre-rendered instructions", provider.requests)
	}
}

func TestOfficialCodexACPCompatibilityProbe(t *testing.T) {
	adapterPath := strings.TrimSpace(os.Getenv("MEDIAGO_TEST_CODEX_ACP"))
	codexPath := strings.TrimSpace(os.Getenv("MEDIAGO_TEST_CODEX_PATH"))
	if adapterPath == "" || codexPath == "" {
		t.Skip("set MEDIAGO_TEST_CODEX_ACP and MEDIAGO_TEST_CODEX_PATH to run the packaged compatibility probe")
	}

	workspaceDir := t.TempDir()
	if configPath := strings.TrimSpace(os.Getenv("MEDIAGO_TEST_CODEX_CONFIG")); configPath != "" {
		config, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatalf("ReadFile(Codex config) error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(workspaceDir, "config.toml"), config, 0o600); err != nil {
			t.Fatalf("WriteFile(Codex config) error = %v", err)
		}
	}
	runner := NewACPAgentRunnerWithDocumentMCPConfigPathAndArgv(
		adapterPath,
		workspaceDir,
		"",
		nil,
		nil,
		func() []string { return []string{adapterPath} },
	)
	runner.SetProcessConfigProvider(ProcessConfigProviderFunc(func(context.Context, ProcessConfigRequest) (ProcessConfig, error) {
		return ProcessConfig{Env: map[string]string{
			"CODEX_HOME":           workspaceDir,
			"CODEX_PATH":           codexPath,
			"DEFAULT_AUTH_REQUEST": `{"methodId":"api-key"}`,
			"NO_BROWSER":           "1",
			"OPENAI_API_KEY":       "mediago-codex-relay",
		}}, nil
	}))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	config, err := runner.InspectSessionConfig(ctx, "compatibility-probe", workspaceDir)
	if err != nil {
		t.Fatalf("InspectSessionConfig() error = %v", err)
	}
	if config.Model == nil || len(config.Model.Options) == 0 {
		t.Fatalf("model config = %#v, want official Codex ACP model options", config.Model)
	}
	foundGPT56 := false
	for _, option := range config.Model.Options {
		if strings.EqualFold(option.Value, "gpt-5.6-sol") {
			foundGPT56 = true
			break
		}
	}
	if !foundGPT56 {
		t.Fatalf("model options = %#v, want gpt-5.6-sol from Codex 0.144.0", config.Model.Options)
	}
}

func TestMergedProcessEnvOverridesRuntimeConfigVariables(t *testing.T) {
	t.Setenv("OPENCODE_CONFIG_DIR", "/old/config")
	t.Setenv("MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY", "old-key")

	env := mergedProcessEnv(ProcessConfig{Env: map[string]string{
		"OPENCODE_CONFIG_DIR":                 "/new/config",
		"MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY": "new-key",
	}})

	if got := envValue(env, "OPENCODE_CONFIG_DIR"); got != "/new/config" {
		t.Fatalf("OPENCODE_CONFIG_DIR = %q, want /new/config", got)
	}
	if got := envValue(env, "MEDIAGO_AGENT_MODEL_MINIMAX_API_KEY"); got != "new-key" {
		t.Fatalf("profile key env = %q, want new-key", got)
	}
}

func TestMergedProcessEnvBypassesProxiesForLoopback(t *testing.T) {
	t.Setenv("NO_PROXY", "internal.example")
	t.Setenv("no_proxy", "localhost,legacy.example")

	env := mergedProcessEnv(ProcessConfig{})

	for _, test := range []struct {
		name string
		want []string
	}{
		{name: "NO_PROXY", want: []string{"internal.example", "127.0.0.1", "localhost", "::1"}},
		{name: "no_proxy", want: []string{"localhost", "legacy.example", "127.0.0.1", "::1"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := strings.Split(envValue(env, test.name), ",")
			if strings.Join(got, ",") != strings.Join(test.want, ",") {
				t.Fatalf("%s = %q, want %q", test.name, got, test.want)
			}
		})
	}
}

func TestAgentRuntimeConfigFromACPSession(t *testing.T) {
	modelDescription := "frontier"
	modeDescription := "Ask before edits"
	modelCategory := acp.SessionConfigOptionCategoryModel
	reasoningCategory := acp.SessionConfigOptionCategoryThoughtLevel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "GPT-5.5", Value: acp.SessionConfigValueId("gpt-5.5"), Description: &modelDescription},
		{Name: "MediaGo/MiniMax M3", Value: acp.SessionConfigValueId("mediago/minimax-m3")},
		{Name: "MediaGo/Qwen MT Plus", Value: acp.SessionConfigValueId("mediago/qwen-mt-plus")},
		{Name: "MediaGo/Speech Preview", Value: acp.SessionConfigValueId("mediago/speech-preview")},
		{Name: "MediaGo/Foo Task", Value: acp.SessionConfigValueId("mediago/foo-task")},
	}
	reasoningOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "Low", Value: acp.SessionConfigValueId("low")},
		{Name: "High", Value: acp.SessionConfigValueId("high")},
	}
	config := AgentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		Modes: &acp.SessionModeState{
			CurrentModeId: acp.SessionModeId("ask"),
			AvailableModes: []acp.SessionMode{
				{
					Id:          acp.SessionModeId("ask"),
					Name:        "Ask",
					Description: &modeDescription,
				},
				{
					Id:   acp.SessionModeId("full-access"),
					Name: "Full access",
				},
			},
		},
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("gpt-5.5"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("reasoning_effort"),
					Name:         "Reasoning effort",
					Category:     &reasoningCategory,
					CurrentValue: acp.SessionConfigValueId("high"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &reasoningOptions},
				},
			},
		},
	})

	if config.Model == nil {
		t.Fatal("model config is nil")
	}
	if config.Model.ConfigID != "model" || config.Model.Source != AgentRuntimeConfigSourceOption || config.Model.CurrentValue != "gpt-5.5" {
		t.Fatalf("model config = %#v, want ACP config option and current value", config.Model)
	}
	if len(config.Model.Options) != 2 ||
		config.Model.Options[0].Value != "gpt-5.5" ||
		config.Model.Options[0].Description != modelDescription ||
		config.Model.Options[1].Value != "mediago/minimax-m3" {
		t.Fatalf("model options = %#v, want only chat-capable model choices", config.Model.Options)
	}

	if config.Reasoning == nil {
		t.Fatal("reasoning config is nil")
	}
	if config.Reasoning.ConfigID != "reasoning_effort" || config.Reasoning.Source != AgentRuntimeConfigSourceOption || config.Reasoning.CurrentValue != "high" {
		t.Fatalf("reasoning config = %#v, want ACP config option", config.Reasoning)
	}
	if len(config.Reasoning.Options) != 2 || config.Reasoning.Options[1].Value != "high" {
		t.Fatalf("reasoning options = %#v, want low/high", config.Reasoning.Options)
	}

	if config.Permission == nil {
		t.Fatal("permission config is nil")
	}
	if config.Permission.Source != AgentRuntimeConfigSourceMode || config.Permission.CurrentValue != "ask" {
		t.Fatalf("permission config = %#v, want ACP mode source and current value", config.Permission)
	}
	if len(config.Permission.Options) != 2 || config.Permission.Options[0].Description != modeDescription {
		t.Fatalf("permission options = %#v, want ask/full-access modes", config.Permission.Options)
	}
}

func TestAgentRuntimeConfigFromACPSessionRestrictsModelsToRuntimeProfiles(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "OpenCode Zen/Big Pickle", Value: acp.SessionConfigValueId("opencode/big-pickle")},
		{Name: "GitHub Copilot/GPT-5 Mini", Value: acp.SessionConfigValueId("github-copilot/gpt-5-mini")},
		{Name: "DMXAPI/GPT-4.1 Mini", Value: acp.SessionConfigValueId("dmxapi/gpt-4.1-mini")},
		{Name: "MediaGo/MiniMax M3", Value: acp.SessionConfigValueId("mediago/MiniMax-M3")},
		{Name: "MiniMax 国内/MiniMax-M3", Value: acp.SessionConfigValueId("minimax-cn/MiniMax-M3")},
	}
	config := agentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("opencode/big-pickle"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	}, agentRuntimeModelFilter{
		Restrict: true,
		AllowedValues: []string{
			"dmxapi/gpt-4.1-mini",
			"mediago/MiniMax-M3",
		},
	})

	if config.Model == nil {
		t.Fatal("model config is nil")
	}
	if config.Model.CurrentValue != "dmxapi/gpt-4.1-mini" {
		t.Fatalf("current model = %q, want first allowed model", config.Model.CurrentValue)
	}
	if len(config.Model.Options) != 2 ||
		config.Model.Options[0].Value != "dmxapi/gpt-4.1-mini" ||
		config.Model.Options[1].Value != "mediago/MiniMax-M3" {
		t.Fatalf("model options = %#v, want only configured runtime profile models", config.Model.Options)
	}
	if config.Reasoning == nil {
		t.Fatal("reasoning config is nil")
	}
}

func TestAgentRuntimeConfigFromACPSessionUsesDiscoveredRelayModels(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "GPT-5.5", Value: acp.SessionConfigValueId("gpt-5.5")},
		{Name: "GPT-5.4", Value: acp.SessionConfigValueId("gpt-5.4")},
		{Name: "GPT-5.4-Mini", Value: acp.SessionConfigValueId("gpt-5.4-mini")},
	}
	discovered := []string{
		"gpt-5.6-sol",
		"gpt-5.6-terra",
		"gpt-5.6-luna",
		"gpt-5.5",
		"gpt-5.4",
		"gpt-5.4-mini",
		"codex-auto-review",
	}
	config := agentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("gpt-5.5"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	}, agentRuntimeModelFilter{
		Restrict:         true,
		AllowedValues:    discovered,
		DiscoveredValues: discovered,
	})

	if config.Model == nil {
		t.Fatal("model config is nil")
	}
	if config.Model.CurrentValue != "gpt-5.5" {
		t.Fatalf("current model = %q, want ACP current model preserved", config.Model.CurrentValue)
	}
	if len(config.Model.Options) != len(discovered) {
		t.Fatalf("model options = %#v, want discovered relay models", config.Model.Options)
	}
	for index, model := range discovered {
		if config.Model.Options[index].Value != model {
			t.Fatalf("model option %d = %#v, want merged models ordered like relay catalog %q", index, config.Model.Options[index], model)
		}
	}
	if config.Model.Options[3].Name != "GPT-5.5" {
		t.Fatalf("existing ACP display name = %q, want preserved", config.Model.Options[3].Name)
	}
}

func TestAgentRuntimeConfigFromACPSessionFallsBackToConfiguredProviders(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "OpenCode Zen/Big Pickle", Value: acp.SessionConfigValueId("opencode/big-pickle")},
		{Name: "GitHub Copilot/GPT-5 Mini", Value: acp.SessionConfigValueId("github-copilot/gpt-5-mini")},
		{Name: "MiniMax/MiniMax-M2.7", Value: acp.SessionConfigValueId("minimax/MiniMax-M2.7")},
		{Name: "MiniMax/MiniMax-M3", Value: acp.SessionConfigValueId("minimax/MiniMax-M3")},
	}
	config := agentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("opencode/big-pickle"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	}, agentRuntimeModelFilter{
		Restrict:         true,
		AllowedValues:    []string{"minimax-cn/MiniMax-M3"},
		AllowedProviders: []string{"minimax-cn"},
	})

	if config.Model == nil {
		t.Fatal("model config is nil")
	}
	if config.Model.CurrentValue != "minimax/MiniMax-M2.7" {
		t.Fatalf("current model = %q, want first configured provider model", config.Model.CurrentValue)
	}
	if len(config.Model.Options) != 2 ||
		config.Model.Options[0].Value != "minimax/MiniMax-M2.7" ||
		config.Model.Options[1].Value != "minimax/MiniMax-M3" {
		t.Fatalf("model options = %#v, want only configured MiniMax provider models", config.Model.Options)
	}
}

func TestAgentRuntimeConfigFromACPSessionHidesModelsWhenRestrictedWithoutProfiles(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "OpenCode Zen/Big Pickle", Value: acp.SessionConfigValueId("opencode/big-pickle")},
		{Name: "GitHub Copilot/GPT-5 Mini", Value: acp.SessionConfigValueId("github-copilot/gpt-5-mini")},
	}
	config := agentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("opencode/big-pickle"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	}, agentRuntimeModelFilter{Restrict: true})

	if config.Model != nil {
		t.Fatalf("model config = %#v, want no model options when no runtime profiles are configured", config.Model)
	}
	if config.Reasoning != nil {
		t.Fatalf("reasoning config = %#v, want no fallback when no configured model remains", config.Reasoning)
	}
}

func TestAgentRuntimeConfigFromACPSessionAddsOpenCodeThinkingWhenOfficialMiniMaxExists(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "MediaGo/Qwen3.5 27B", Value: acp.SessionConfigValueId("mediago/qwen3.5-27b")},
		{Name: "MiniMax 国内/MiniMax-M3", Value: acp.SessionConfigValueId("minimax-cn/MiniMax-M3")},
	}
	config := AgentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("mediago/qwen3.5-27b"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	})

	if config.Reasoning == nil {
		t.Fatal("reasoning config is nil")
	}
	if config.Reasoning.ConfigID != "effort" || config.Reasoning.CurrentValue != "none" {
		t.Fatalf("reasoning config = %#v, want OpenCode effort fallback", config.Reasoning)
	}
	if len(config.Reasoning.Options) != 2 || config.Reasoning.Options[1].Value != "thinking" {
		t.Fatalf("reasoning options = %#v, want none/thinking", config.Reasoning.Options)
	}
}

func TestAgentRuntimeConfigFromACPSessionAddsOpenCodeThinkingWhenMediagoMiniMaxM3Exists(t *testing.T) {
	modelCategory := acp.SessionConfigOptionCategoryModel
	modelOptions := acp.SessionConfigSelectOptionsUngrouped{
		{Name: "MediaGo/Qwen3.5 27B", Value: acp.SessionConfigValueId("mediago/qwen3.5-27b")},
		{Name: "MediaGo/MiniMax M3", Value: acp.SessionConfigValueId("mediago/MiniMax-M3")},
	}
	config := AgentRuntimeConfigFromACPSession(acp.NewSessionResponse{
		SessionId: acp.SessionId("session-1"),
		ConfigOptions: []acp.SessionConfigOption{
			{
				Select: &acp.SessionConfigOptionSelect{
					Id:           acp.SessionConfigId("model"),
					Name:         "Model",
					Category:     &modelCategory,
					CurrentValue: acp.SessionConfigValueId("mediago/qwen3.5-27b"),
					Options:      acp.SessionConfigSelectOptions{Ungrouped: &modelOptions},
				},
			},
		},
	})

	if config.Reasoning == nil {
		t.Fatal("reasoning config is nil")
	}
	if config.Reasoning.ConfigID != "effort" || config.Reasoning.CurrentValue != "none" {
		t.Fatalf("reasoning config = %#v, want OpenCode effort fallback", config.Reasoning)
	}
}

func TestApplyACPSessionSelectionsSkipsReasoningForExternalProviderModel(t *testing.T) {
	for _, model := range []string{
		"deepseek/deepseek-chat",
		"dmx/gemini-3.1-pro-preview",
		"mediago/MiniMax-M2.7",
		"minimax-cn/MiniMax-M2.7",
		"openrouter/openai/gpt-4.1-mini",
	} {
		t.Run(model, func(t *testing.T) {
			configurator := &recordingACPSessionConfigurator{}

			err := applyACPSessionSelections(
				context.Background(),
				configurator,
				acp.SessionId("session-1"),
				agentRunRequest{
					Model: agentACPConfigSelection{
						ConfigID: "model",
						Source:   AgentRuntimeConfigSourceOption,
						Value:    model,
					},
					Reasoning: agentACPConfigSelection{
						ConfigID: "effort",
						Source:   AgentRuntimeConfigSourceOption,
						Value:    "thinking",
					},
					Permission: agentACPConfigSelection{
						Source: AgentRuntimeConfigSourceMode,
						Value:  "ask",
					},
				},
				nil,
			)
			if err != nil {
				t.Fatalf("applyACPSessionSelections returned error: %v", err)
			}
			if len(configurator.configRequests) != 1 {
				t.Fatalf("config requests = %#v, want only model attempt", configurator.configRequests)
			}
			if got := string(configurator.configRequests[0].ValueId.Value); got != model {
				t.Fatalf("model value = %q, want %q", got, model)
			}
			if len(configurator.modeRequests) != 1 || configurator.modeRequests[0].ModeId != acp.SessionModeId("ask") {
				t.Fatalf("mode requests = %#v, want ask applied after skipped reasoning", configurator.modeRequests)
			}
		})
	}
}

func TestApplyACPSessionSelectionsAppliesReasoningForMiniMaxM3(t *testing.T) {
	for _, model := range []string{
		"minimax-cn/MiniMax-M3",
		"minimax/MiniMax-M3",
		"mediago/MiniMax-M3",
	} {
		t.Run(model, func(t *testing.T) {
			configurator := &recordingACPSessionConfigurator{}

			err := applyACPSessionSelections(
				context.Background(),
				configurator,
				acp.SessionId("session-1"),
				agentRunRequest{
					Model: agentACPConfigSelection{
						ConfigID: "model",
						Source:   AgentRuntimeConfigSourceOption,
						Value:    model,
					},
					Reasoning: agentACPConfigSelection{
						ConfigID: "effort",
						Source:   AgentRuntimeConfigSourceOption,
						Value:    "thinking",
					},
					Permission: agentACPConfigSelection{
						Source: AgentRuntimeConfigSourceMode,
						Value:  "build",
					},
				},
				nil,
			)
			if err != nil {
				t.Fatalf("applyACPSessionSelections returned error: %v", err)
			}
			if len(configurator.configRequests) != 2 {
				t.Fatalf("config requests = %#v, want model and reasoning attempts", configurator.configRequests)
			}
			if got := string(configurator.configRequests[1].ValueId.Value); got != "thinking" {
				t.Fatalf("reasoning value = %q, want thinking", got)
			}
		})
	}
}

func TestApplyACPSessionSelectionsIgnoresInvalidReasoningValue(t *testing.T) {
	configurator := &recordingACPSessionConfigurator{}

	err := applyACPSessionSelections(
		context.Background(),
		configurator,
		acp.SessionId("session-1"),
		agentRunRequest{
			Model: agentACPConfigSelection{
				ConfigID: "model",
				Source:   AgentRuntimeConfigSourceOption,
				Value:    "gpt-5",
			},
			Reasoning: agentACPConfigSelection{
				ConfigID: "effort",
				Source:   AgentRuntimeConfigSourceOption,
				Value:    "thinking",
			},
			Permission: agentACPConfigSelection{
				Source: AgentRuntimeConfigSourceMode,
				Value:  "ask",
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("applyACPSessionSelections returned error: %v", err)
	}
	if len(configurator.configRequests) != 2 {
		t.Fatalf("config requests = %#v, want model and reasoning attempts", configurator.configRequests)
	}
	if got := string(configurator.configRequests[1].ValueId.Value); got != "thinking" {
		t.Fatalf("reasoning value = %q, want thinking", got)
	}
	if len(configurator.modeRequests) != 1 || configurator.modeRequests[0].ModeId != acp.SessionModeId("ask") {
		t.Fatalf("mode requests = %#v, want ask applied after ignored reasoning", configurator.modeRequests)
	}
}

func TestApplyACPSessionSelectionsReturnsModelInvalidParams(t *testing.T) {
	configurator := &recordingACPSessionConfigurator{invalidModelValue: "missing-model"}

	err := applyACPSessionSelections(
		context.Background(),
		configurator,
		acp.SessionId("session-1"),
		agentRunRequest{
			Model: agentACPConfigSelection{
				ConfigID: "model",
				Source:   AgentRuntimeConfigSourceOption,
				Value:    "missing-model",
			},
		},
		nil,
	)
	if err == nil {
		t.Fatal("applyACPSessionSelections returned nil, want model error")
	}
}

func TestACPClientSessionUpdatePublishesToolCallPayload(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)
	line := 7

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall(
			"call-readme",
			"读取 README",
			acp.WithStartKind(acp.ToolKindRead),
			acp.WithStartStatus(acp.ToolCallStatusPending),
			acp.WithStartLocations([]acp.ToolCallLocation{{Path: "README.md", Line: &line}}),
			acp.WithStartRawInput(map[string]any{"path": "README.md", "limit": 20}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.Type != "agent.acp" || event.ACP == nil {
		t.Fatalf("event = %#v, want structured agent.acp event", event)
	}
	if event.ACP.Kind != "toolCall" || event.ACP.ToolCallID != "call-readme" || event.ACP.ToolKind != "read" {
		t.Fatalf("acp = %#v, want read tool call", event.ACP)
	}
	if event.TurnID != "run-1" || event.ItemID != "call-readme" || event.Phase != "commentary" {
		t.Fatalf("event semantics = %#v, want tool call commentary identity", event)
	}
	if len(event.ACP.Locations) != 1 || event.ACP.Locations[0].Path != "README.md" || event.ACP.Locations[0].Line == nil || *event.ACP.Locations[0].Line != line {
		t.Fatalf("locations = %#v, want README.md:7", event.ACP.Locations)
	}
	var rawInput map[string]any
	if err := json.Unmarshal(event.ACP.RawInput, &rawInput); err != nil {
		t.Fatalf("rawInput unmarshal failed: %v", err)
	}
	if rawInput["path"] != "README.md" || rawInput["limit"].(float64) != 20 {
		t.Fatalf("rawInput = %#v, want path and limit", rawInput)
	}
}

type recordingProcessConfigProvider struct {
	config   ProcessConfig
	requests []ProcessConfigRequest
}

func (provider *recordingProcessConfigProvider) PrepareACPProcessConfig(_ context.Context, request ProcessConfigRequest) (ProcessConfig, error) {
	provider.requests = append(provider.requests, request)
	return provider.config, nil
}

type recordingACPSessionConfigurator struct {
	configRequests    []acp.SetSessionConfigOptionRequest
	modeRequests      []acp.SetSessionModeRequest
	invalidModelValue string
}

func (configurator *recordingACPSessionConfigurator) SetSessionConfigOption(_ context.Context, request acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error) {
	configurator.configRequests = append(configurator.configRequests, request)
	if request.ValueId != nil && string(request.ValueId.Value) == configurator.invalidModelValue {
		return acp.SetSessionConfigOptionResponse{}, acp.NewInvalidParams(map[string]any{
			"model": request.ValueId.Value,
		})
	}
	if request.ValueId != nil && request.ValueId.ConfigId == acp.SessionConfigId("effort") && request.ValueId.Value == acp.SessionConfigValueId("thinking") {
		return acp.SetSessionConfigOptionResponse{}, acp.NewInvalidParams(map[string]any{
			"effort": "thinking",
		})
	}
	return acp.SetSessionConfigOptionResponse{}, nil
}

func (configurator *recordingACPSessionConfigurator) SetSessionMode(_ context.Context, request acp.SetSessionModeRequest) (acp.SetSessionModeResponse, error) {
	configurator.modeRequests = append(configurator.modeRequests, request)
	return acp.SetSessionModeResponse{}, nil
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, item := range env {
		if strings.HasPrefix(item, prefix) {
			return strings.TrimPrefix(item, prefix)
		}
	}
	return ""
}

func TestACPClientSessionUpdatePublishesMessageChunkDelta(t *testing.T) {
	events := []agentEvent{}
	messageID := "message-final-1"
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.SessionUpdate{
			AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
				Content:   acp.TextBlock("正在处理第一章。"),
				MessageId: &messageID,
			},
		},
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.Type != "agent.message.delta" {
		t.Fatalf("event type = %q, want agent.message.delta", event.Type)
	}
	if event.Delta != "正在处理第一章。" {
		t.Fatalf("delta = %q, want chunk text", event.Delta)
	}
	if event.TurnID != "run-1" || event.ItemID != messageID || event.Phase != "commentary" {
		t.Fatalf("event semantics = %#v, want running ACP message commentary", event)
	}
	if client.messageText() != "正在处理第一章。" {
		t.Fatalf("buffered message = %q, want chunk text", client.messageText())
	}
	if !client.hasStreamedMessage() {
		t.Fatal("hasStreamedMessage() = false, want true")
	}
}

func TestACPClientSessionUpdatePreservesFinalAnswerPhase(t *testing.T) {
	events := []agentEvent{}
	messageID := "message-final-1"
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.SessionUpdate{
			AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
				Meta: map[string]any{
					"codex": map[string]any{"phase": "final_answer"},
				},
				Content:   acp.TextBlock("最终回复。"),
				MessageId: &messageID,
			},
		},
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.ItemID != messageID || event.Phase != "final_answer" {
		t.Fatalf("event semantics = %#v, want final-answer message item", event)
	}
}

func TestACPClientSessionUpdateUsesStableFallbackMessageItemID(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	for _, text := range []string{"第一段", "第二段"} {
		if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
			Update: acp.UpdateAgentMessage(acp.TextBlock(text)),
		}); err != nil {
			t.Fatalf("SessionUpdate returned error: %v", err)
		}
	}

	if len(events) != 2 {
		t.Fatalf("events = %#v, want two delta events", events)
	}
	if events[0].ItemID == "" || events[1].ItemID != events[0].ItemID {
		t.Fatalf("item ids = %q, %q; want one stable fallback", events[0].ItemID, events[1].ItemID)
	}
	if client.messageItemID() != events[0].ItemID {
		t.Fatalf("final item id = %q, want %q", client.messageItemID(), events[0].ItemID)
	}
}

func TestACPClientToolBoundaryClosesRunningMessageCandidate(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)
	messageID := "message-before-tool"

	if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.SessionUpdate{
			AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
				Content:   acp.TextBlock("我先读取文档。"),
				MessageId: &messageID,
			},
		},
	}); err != nil {
		t.Fatalf("publishing message chunk: %v", err)
	}
	if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall("call-read", "读取文档", acp.WithStartKind(acp.ToolKindRead)),
	}); err != nil {
		t.Fatalf("publishing tool call: %v", err)
	}

	if len(events) != 2 {
		t.Fatalf("events = %#v, want message then tool", events)
	}
	if events[0].ItemID != messageID || events[0].Phase != "commentary" {
		t.Fatalf("pre-tool message = %#v, want commentary", events[0])
	}
	if client.messageItemID() != "" {
		t.Fatalf("completion candidate = %q, want tool boundary to clear pre-tool item", client.messageItemID())
	}
}

func TestACPClientProgressToolFinalKeepsOnlyFinalItemVisible(t *testing.T) {
	client := &acpClient{
		runID:   "run-1",
		publish: func(agentEvent) {},
	}
	client.setAcceptingSessionUpdates(true)
	progressID := "message-progress"
	finalID := "message-final"

	updates := []acp.SessionUpdate{
		{
			AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
				Content:   acp.TextBlock("我先检查文档。"),
				MessageId: &progressID,
			},
		},
		acp.StartToolCall("call-read", "读取文档", acp.WithStartKind(acp.ToolKindRead)),
		{
			AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
				Content:   acp.TextBlock("文档已更新。"),
				MessageId: &finalID,
			},
		},
	}
	for _, update := range updates {
		if err := client.SessionUpdate(context.Background(), acp.SessionNotification{Update: update}); err != nil {
			t.Fatalf("SessionUpdate returned error: %v", err)
		}
	}

	if client.messageText() != "我先检查文档。文档已更新。" {
		t.Fatalf("full message = %q, want complete raw transcript", client.messageText())
	}
	if client.messageItemText() != "文档已更新。" || client.messageItemID() != finalID {
		t.Fatalf("final item = (%q, %q), want final segment", client.messageItemID(), client.messageItemText())
	}
	result := parseACPFinalResponseForItem(client.messageText(), client.messageItemText(), agentRunRequest{})
	if result.Message != "文档已更新。" || strings.Contains(result.Message, "我先检查") {
		t.Fatalf("result message = %q, want progress excluded", result.Message)
	}
}

func TestScopedACPEventPublisherAddsActivitySemantics(t *testing.T) {
	events := []agentEvent{}
	publish := scopedACPEventPublisher("run-1", func(event agentEvent) {
		events = append(events, event)
	})

	publish(agentEvent{ID: "activity-1", Type: "agent.activity", Message: "正在恢复会话"})

	if len(events) != 1 {
		t.Fatalf("events = %#v, want one activity", events)
	}
	event := events[0]
	if event.RunID != "run-1" || event.TurnID != "run-1" || event.ItemID != "activity-1" || event.Phase != "commentary" {
		t.Fatalf("event semantics = %#v, want run-scoped commentary activity", event)
	}
}

func TestACPClientSessionUpdateIgnoresReplayOutsidePrompt(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall("call-history", "历史工具调用"),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("events = %#v, want replay updates ignored", events)
	}
}

func TestShouldRetryEmptyACPPrompt(t *testing.T) {
	emptyEndTurn := acp.PromptResponse{
		StopReason: acp.StopReasonEndTurn,
		Usage:      &acp.Usage{},
	}

	tests := []struct {
		name         string
		response     acp.PromptResponse
		message      string
		runtimeError string
		hadActivity  bool
		want         bool
	}{
		{
			name:     "retries empty zero-token response",
			response: emptyEndTurn,
			want:     true,
		},
		{
			name:     "does not retry when message streamed",
			response: emptyEndTurn,
			message:  "已完成。",
		},
		{
			name:         "does not retry provider runtime error",
			response:     emptyEndTurn,
			runtimeError: "对应 API Key 的余额不足。",
		},
		{
			name:        "does not retry after prompt activity",
			response:    emptyEndTurn,
			hadActivity: true,
		},
		{
			name: "does not retry nonzero usage",
			response: acp.PromptResponse{
				StopReason: acp.StopReasonEndTurn,
				Usage:      &acp.Usage{InputTokens: 12, OutputTokens: 0, TotalTokens: 12},
			},
		},
		{
			name: "does not retry unsupported stop reason",
			response: acp.PromptResponse{
				StopReason: acp.StopReasonCancelled,
				Usage:      &acp.Usage{},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRetryEmptyACPPrompt(tt.response, tt.message, tt.runtimeError, tt.hadActivity)
			if got != tt.want {
				t.Fatalf("shouldRetryEmptyACPPrompt() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestShouldRequestACPFinalMessage(t *testing.T) {
	endTurn := acp.PromptResponse{StopReason: acp.StopReasonEndTurn}

	tests := []struct {
		name         string
		response     acp.PromptResponse
		message      string
		runtimeError string
		hadActivity  bool
		want         bool
	}{
		{
			name:        "requests final message after activity without assistant text",
			response:    endTurn,
			hadActivity: true,
			want:        true,
		},
		{
			name:     "does not request final message when no activity happened",
			response: endTurn,
		},
		{
			name:        "does not request final message when assistant text exists",
			response:    endTurn,
			message:     "已完成。",
			hadActivity: true,
		},
		{
			name:         "does not hide provider runtime error",
			response:     endTurn,
			runtimeError: "对应 API Key 的余额不足。",
			hadActivity:  true,
		},
		{
			name: "does not request final message for cancellation",
			response: acp.PromptResponse{
				StopReason: acp.StopReasonCancelled,
			},
			hadActivity: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRequestACPFinalMessage(tt.response, tt.message, tt.runtimeError, tt.hadActivity)
			if got != tt.want {
				t.Fatalf("shouldRequestACPFinalMessage() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBuildACPFinalMessagePrompt(t *testing.T) {
	prompt := buildACPFinalMessagePrompt()
	for _, want := range []string{"最终回复", "不要调用工具", "用户最后一条消息"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt = %q, want %q", prompt, want)
		}
	}
}

func TestACPAgentRunnerBuildPromptForRequestUsesUserIncrementAfterNativeInjection(t *testing.T) {
	runner := &acpAgentRunner{
		buildPrompt: func(request AgentRunRequest) string {
			if request.Prompt != "你好" {
				t.Fatalf("request prompt = %q, want original prompt", request.Prompt)
			}
			return "固定系统提示"
		},
	}

	request := agentRunRequest{Prompt: "你好"}
	fixedInstructions := runner.fixedInstructions(request)
	prompt := runner.buildPromptForRequest(request, fixedInstructions, true)

	if prompt != "你好" {
		t.Fatalf("prompt = %q, want user increment only", prompt)
	}
	if strings.Contains(prompt, "固定系统提示") || strings.Contains(prompt, "# 用户请求") {
		t.Fatalf("prompt = %q, should not include fixed instructions after native injection", prompt)
	}
}

func TestACPAgentRunnerBuildPromptForRequestKeepsCompatibilityFallback(t *testing.T) {
	runner := &acpAgentRunner{
		buildPrompt: func(AgentRunRequest) string {
			return "固定系统提示"
		},
	}
	request := agentRunRequest{Prompt: "你好"}
	fixedInstructions := runner.fixedInstructions(request)

	prompt := runner.buildPromptForRequest(request, fixedInstructions, false)

	if !strings.Contains(prompt, "固定系统提示") ||
		!strings.Contains(prompt, "# 用户请求") ||
		!strings.Contains(prompt, "你好") {
		t.Fatalf("prompt = %q, want fixed prompt and user request fallback", prompt)
	}
}

func TestACPAgentRunnerBuildPromptForRequestFallsBackToUserPrompt(t *testing.T) {
	runner := &acpAgentRunner{}

	request := agentRunRequest{Prompt: "你好"}
	prompt := runner.buildPromptForRequest(request, runner.fixedInstructions(request), false)

	if prompt != "你好" {
		t.Fatalf("prompt = %q, want user prompt only", prompt)
	}
}

func TestInstructionFingerprintIsStableAndScoped(t *testing.T) {
	first := instructionFingerprint("codex", "native", "固定系统提示")
	second := instructionFingerprint("codex", "native", "固定系统提示")
	if first == "" || first != second {
		t.Fatalf("fingerprints = %q and %q, want stable non-empty value", first, second)
	}
	if first == instructionFingerprint("opencode", "native", "固定系统提示") {
		t.Fatal("fingerprint should change with backend")
	}
	if first == instructionFingerprint("codex", "inline", "固定系统提示") {
		t.Fatal("fingerprint should change with delivery mode")
	}
	if first == instructionFingerprint("codex", "native", "更新后的系统提示") {
		t.Fatal("fingerprint should change with instruction body")
	}
}

func TestInstructionHashMatchesRequiresSameDeliveryState(t *testing.T) {
	codexNativeHash := instructionFingerprint("codex", "native", "固定系统提示")
	codexInlineHash := instructionFingerprint("codex", "inline", "固定系统提示")
	opencodeNativeHash := instructionFingerprint("opencode", "native", "固定系统提示")
	tests := []struct {
		name    string
		stored  string
		current string
		want    bool
	}{
		{name: "legacy session migrates to versioned inline", current: codexInlineHash},
		{name: "legacy session migrates to native", current: codexNativeHash},
		{name: "same native instructions resume", stored: codexNativeHash, current: codexNativeHash, want: true},
		{name: "same inline instructions resume", stored: codexInlineHash, current: codexInlineHash, want: true},
		{name: "backend change migrates", stored: codexNativeHash, current: opencodeNativeHash},
		{name: "native rollback to inline migrates", stored: codexNativeHash, current: codexInlineHash},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := instructionHashMatches(test.stored, test.current); got != test.want {
				t.Fatalf("instructionHashMatches(%q, %q) = %v, want %v", test.stored, test.current, got, test.want)
			}
		})
	}
}

func TestACPBackendIdentityScopesCustomCommands(t *testing.T) {
	first := acpBackendIdentity("custom-acp", []string{"--profile", "one"})
	if first == "" || first != acpBackendIdentity("custom-acp", []string{"--profile", "one"}) {
		t.Fatalf("custom backend identity = %q, want stable non-empty value", first)
	}
	if first == acpBackendIdentity("custom-acp", []string{"--profile", "two"}) {
		t.Fatal("custom backend identity should include argv")
	}
	if got := acpBackendIdentity("codex-acp", nil); got != "codex" {
		t.Fatalf("Codex backend identity = %q, want codex", got)
	}
}

func TestFallbackACPFinalMessage(t *testing.T) {
	tests := []struct {
		name        string
		request     agentRunRequest
		hadActivity bool
		want        string
	}{
		{
			name:    "simple Chinese greeting without activity",
			request: agentRunRequest{Prompt: "你好"},
			want:    "模型调用没有返回可展示内容；这次不能确认调用成功。请重试，或切换模型后再试。",
		},
		{
			name:    "simple English greeting without activity",
			request: agentRunRequest{Prompt: "Hello!"},
			want:    "模型调用没有返回可展示内容；这次不能确认调用成功。请重试，或切换模型后再试。",
		},
		{
			name:        "activity without final message",
			request:     agentRunRequest{Prompt: "帮我改写第二章"},
			hadActivity: true,
			want:        "模型产生了思考或工具调用事件，但 ACP 运行时没有发送可展示的最终回复；这次不能确认调用成功。请重试，或切换模型后再试。",
		},
		{
			name:    "no activity",
			request: agentRunRequest{Prompt: "帮我改写第二章"},
			want:    "模型调用没有返回可展示内容；这次不能确认调用成功。请重试，或切换模型后再试。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fallbackACPFinalMessage(tt.request, tt.hadActivity)
			if got != tt.want {
				t.Fatalf("fallbackACPFinalMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestACPClientSessionUsageUpdateDoesNotCountAsPromptActivity(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.beginPromptMetrics()
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.SessionUpdate{
			UsageUpdate: &acp.SessionUsageUpdate{
				Used: 0,
				Size: 1000000,
			},
		},
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("events = %#v, want no published event for usage update", events)
	}
	if client.hasPromptActivity() {
		t.Fatal("usage_update should not count as prompt activity")
	}
	metrics := client.promptMetrics()
	if metrics[1] != 1 {
		t.Fatalf("update_count metric = %#v, want 1", metrics)
	}
}

func TestACPClientSessionUpdateWritesRawACPEventLog(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(root, "project-safe")
	rawLog := newACPRawLogger(root, projectDir, "project-safe", "session-1", "run-1")
	rawLog.setACPSessionID("acp-session-1")
	client := &acpClient{
		sessionID: "session-1",
		runID:     "run-1",
		rawLog:    rawLog,
		publish:   func(agentEvent) {},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall(
			"call-readme",
			"读取 README",
			acp.WithStartKind(acp.ToolKindRead),
			acp.WithStartStatus(acp.ToolCallStatusPending),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}

	path := filepath.Join(projectDir, "agent-sessions", "session-1", "acp-events.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading acp event log: %v", err)
	}
	var entry struct {
		ProjectID    string         `json:"projectId"`
		SessionID    string         `json:"sessionId"`
		RunID        string         `json:"runId"`
		ACPSessionID string         `json:"acpSessionId"`
		Source       string         `json:"source"`
		Raw          map[string]any `json:"raw"`
		Normalized   map[string]any `json:"normalized"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(data))), &entry); err != nil {
		t.Fatalf("unmarshalling acp event log: %v\n%s", err, data)
	}
	if entry.ProjectID != "project-safe" || entry.SessionID != "session-1" || entry.RunID != "run-1" || entry.ACPSessionID != "acp-session-1" {
		t.Fatalf("entry identity = %#v, want project/session/run/acp ids", entry)
	}
	if entry.Source != "sdk.session_update" {
		t.Fatalf("source = %q, want sdk.session_update", entry.Source)
	}
	if entry.Raw["update"] == nil {
		t.Fatalf("raw = %#v, want original update JSON", entry.Raw)
	}
	if entry.Normalized["type"] != "agent.acp" {
		t.Fatalf("normalized = %#v, want agent.acp summary", entry.Normalized)
	}
}

func TestACPStderrWriterWritesRawLogs(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(root, "project-safe")
	rawLog := newACPRawLogger(root, projectDir, "project-safe", "session-1", "run-1")
	rawLog.setACPSessionID("acp-session-1")
	events := []agentEvent{}
	writer := acpStderrWriter{
		sessionID: "session-1",
		runID:     "run-1",
		rawLog:    rawLog,
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	message := "ERROR codex_core::session::session: failed to load skill"

	n, err := writer.Write([]byte(message))
	if err != nil || n != len(message) {
		t.Fatalf("Write returned n=%d err=%v, want n=%d nil", n, err, len(message))
	}
	if len(events) != 1 || events[0].Type != "agent.acp" || events[0].ACP == nil || events[0].ACP.Kind != ACPRuntimeLogKind {
		t.Fatalf("events = %#v, want one ACP runtimeLog event", events)
	}
	base := filepath.Join(projectDir, "agent-sessions", "session-1")
	stderrData, err := os.ReadFile(filepath.Join(base, "stderr.log"))
	if err != nil {
		t.Fatalf("reading stderr log: %v", err)
	}
	if !strings.Contains(string(stderrData), message) {
		t.Fatalf("stderr.log = %q, want raw message", stderrData)
	}
	eventsData, err := os.ReadFile(filepath.Join(base, "acp-events.jsonl"))
	if err != nil {
		t.Fatalf("reading acp events log: %v", err)
	}
	var entry struct {
		Source     string         `json:"source"`
		Raw        string         `json:"raw"`
		Normalized map[string]any `json:"normalized"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(eventsData))), &entry); err != nil {
		t.Fatalf("unmarshalling stderr event log: %v\n%s", err, eventsData)
	}
	normalizedACP, _ := entry.Normalized["acp"].(map[string]any)
	if entry.Source != "process.stderr" ||
		entry.Raw != message ||
		entry.Normalized["type"] != "agent.acp" ||
		normalizedACP["kind"] != ACPRuntimeLogKind {
		t.Fatalf("entry = %#v, want stderr raw and ACP runtimeLog summary", entry)
	}
}

func TestACPStdoutLogReaderWritesRawLinesWithoutChangingStream(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(root, "project-safe")
	rawLog := newACPRawLogger(root, projectDir, "project-safe", "session-1", "run-1")
	rawLog.setACPSessionID("acp-session-1")
	input := "{\"jsonrpc\":\"2.0\",\"method\":\"session/update\"}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}"

	data, err := io.ReadAll(newACPStdoutLogReader(strings.NewReader(input), rawLog))
	if err != nil {
		t.Fatalf("ReadAll returned error: %v", err)
	}
	if string(data) != input {
		t.Fatalf("stream = %q, want original input", data)
	}

	base := filepath.Join(projectDir, "agent-sessions", "session-1")
	stdoutData, err := os.ReadFile(filepath.Join(base, "stdout.log"))
	if err != nil {
		t.Fatalf("reading stdout log: %v", err)
	}
	if strings.Count(string(stdoutData), "\n") != 2 || !strings.Contains(string(stdoutData), "session/update") {
		t.Fatalf("stdout.log = %q, want both raw JSON-RPC lines", stdoutData)
	}
	eventsData, err := os.ReadFile(filepath.Join(base, "acp-events.jsonl"))
	if err != nil {
		t.Fatalf("reading acp events log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(eventsData)), "\n")
	if len(lines) != 2 {
		t.Fatalf("raw event lines = %d, want 2\n%s", len(lines), eventsData)
	}
	var entry struct {
		ACPSessionID string `json:"acpSessionId"`
		Source       string `json:"source"`
		Raw          string `json:"raw"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("unmarshalling stdout event log: %v\n%s", err, lines[0])
	}
	if entry.Source != "process.stdout" || entry.ACPSessionID != "acp-session-1" || !strings.Contains(entry.Raw, "session/update") {
		t.Fatalf("entry = %#v, want raw stdout JSON-RPC line", entry)
	}
}

func TestACPClientSessionUpdatePublishesToolCallUpdatePayload(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"call-edit",
			acp.WithUpdateTitle("更新 README"),
			acp.WithUpdateStatus(acp.ToolCallStatusCompleted),
			acp.WithUpdateContent([]acp.ToolCallContent{
				acp.ToolDiffContent("README.md", "# 新标题\n", "# 旧标题\n"),
			}),
			acp.WithUpdateRawOutput(map[string]any{"ok": true, "bytes": 13}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.Type != "agent.acp" || event.ACP == nil {
		t.Fatalf("event = %#v, want structured agent.acp event", event)
	}
	if event.ACP.Kind != "toolCallUpdate" || event.ACP.ToolCallID != "call-edit" || event.ACP.Status != "completed" {
		t.Fatalf("acp = %#v, want completed tool call update", event.ACP)
	}
	if len(event.ACP.Content) != 1 || event.ACP.Content[0].Type != "diff" {
		t.Fatalf("content = %#v, want one diff block", event.ACP.Content)
	}
	if event.ACP.Content[0].Path != "README.md" || event.ACP.Content[0].OldText != "# 旧标题\n" || event.ACP.Content[0].NewText != "# 新标题\n" {
		t.Fatalf("diff = %#v, want README old/new text", event.ACP.Content[0])
	}
	var rawOutput map[string]any
	if err := json.Unmarshal(event.ACP.RawOutput, &rawOutput); err != nil {
		t.Fatalf("rawOutput unmarshal failed: %v", err)
	}
	if rawOutput["ok"] != true || rawOutput["bytes"].(float64) != 13 {
		t.Fatalf("rawOutput = %#v, want ok and bytes", rawOutput)
	}
}

func TestACPClientSessionUpdateIgnoresProviderErrorTextInCompletedToolResult(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	// A generation submission completed with images while its structured output
	// still carries an earlier provider balance error as data. A completed tool
	// call must not be treated as a run failure.
	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"call-poll",
			acp.WithUpdateTitle("Tool: mediago_drama_generation/generate_media"),
			acp.WithUpdateStatus(acp.ToolCallStatusCompleted),
			acp.WithUpdateRawOutput(map[string]any{
				"status": "succeeded",
				"error":  "当前 API Key 余额不足，请充值后重试。",
				"assets": []map[string]any{{"kind": "image", "url": "https://example.com/li-jun.png"}},
			}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if got := client.runtimeErrorText(); got != "" {
		t.Fatalf("runtimeErrorText = %q, want empty for a completed tool result", got)
	}
	if len(events) != 1 || events[0].ACP == nil {
		t.Fatalf("events = %#v, want one ACP event", events)
	}
	event := events[0]
	if event.ACP.Kind != "toolCallUpdate" || event.ACP.Status != "completed" {
		t.Fatalf("acp = %#v, want completed tool call update", event.ACP)
	}
	if strings.Contains(event.Message, "余额不足") {
		t.Fatalf("message = %q, want no balance alert for a completed tool result", event.Message)
	}
}

func TestACPClientSessionUpdateReportsProviderErrorInFailedToolCall(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"call-fail",
			acp.WithUpdateTitle("工具调用"),
			acp.WithUpdateStatus(acp.ToolCallStatusFailed),
			acp.WithUpdateContent([]acp.ToolCallContent{
				acp.ToolContent(acp.TextBlock("insufficient_quota: credit balance is too low")),
			}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if got := client.runtimeErrorText(); got != apiKeyBalanceInsufficientMessage {
		t.Fatalf("runtimeErrorText = %q, want balance alert for a failed tool call", got)
	}
	if len(events) != 1 || events[0].Message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("events = %#v, want failed tool call to surface the balance alert", events)
	}
}

func TestACPClientSessionUpdateClassifiesCodexRuntimeLog(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)
	logText := "2026-06-03T09:43:13.788359Z ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---"

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"2026-06-03T09:43:13.788359Z",
			acp.WithUpdateTitle("工具调用"),
			acp.WithUpdateKind(acp.ToolKindOther),
			acp.WithUpdateStatus(acp.ToolCallStatusFailed),
			acp.WithUpdateContent([]acp.ToolCallContent{
				acp.ToolContent(acp.TextBlock(logText)),
			}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 || events[0].ACP == nil {
		t.Fatalf("events = %#v, want one ACP event", events)
	}
	event := events[0]
	if event.ACP.Kind != ACPRuntimeLogKind {
		t.Fatalf("kind = %q, want runtimeLog", event.ACP.Kind)
	}
	if event.ACP.ToolCallID != "2026-06-03T09:43:13.788359Z" || event.ACP.Status != "failed" {
		t.Fatalf("acp = %#v, want original id and failed status", event.ACP)
	}
	if len(event.ACP.Content) != 1 || event.ACP.Content[0].Text != logText {
		t.Fatalf("content = %#v, want runtime log text", event.ACP.Content)
	}
	if !strings.Contains(event.Message, "failed to load skill") {
		t.Fatalf("message = %q, want truncated runtime log text", event.Message)
	}
}

func TestACPClientSessionUpdateDoesNotUseToolCallIDAsTitle(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"2026-05-24T19:57:40.005581Z",
			acp.WithUpdateStatus(acp.ToolCallStatusFailed),
			acp.WithUpdateContent([]acp.ToolCallContent{
				acp.ToolContent(acp.TextBlock("failed to run tool")),
			}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.ACP == nil {
		t.Fatalf("event = %#v, want ACP payload", event)
	}
	if event.ACP.Title != "" {
		t.Fatalf("title = %q, want empty when ACP omitted title", event.ACP.Title)
	}
	if event.ACP.ToolCallID != "2026-05-24T19:57:40.005581Z" {
		t.Fatalf("toolCallId = %q, want original id preserved", event.ACP.ToolCallID)
	}
}

func TestACPClientSessionUpdateInfersMCPToolKind(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall(
			"call-get-comment",
			"Tool: mediago_drama/get_comment",
			acp.WithStartStatus(acp.ToolCallStatusCompleted),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 || events[0].ACP == nil {
		t.Fatalf("events = %#v, want one ACP event", events)
	}
	if events[0].ACP.ToolKind != "read" {
		t.Fatalf("toolKind = %q, want read", events[0].ACP.ToolKind)
	}
}

func TestACPClientSessionUpdatePublishesPlanPayload(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		runID: "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdatePlan(
			acp.PlanEntry{
				Content:  "读取 README",
				Priority: acp.PlanEntryPriorityHigh,
				Status:   acp.PlanEntryStatusCompleted,
			},
			acp.PlanEntry{
				Content:  "写入新章节",
				Priority: acp.PlanEntryPriorityMedium,
				Status:   acp.PlanEntryStatusInProgress,
			},
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.Type != "agent.acp" || event.ACP == nil {
		t.Fatalf("event = %#v, want structured agent.acp event", event)
	}
	if event.ACP.Kind != "plan" {
		t.Fatalf("kind = %q, want plan", event.ACP.Kind)
	}
	if event.TurnID != "run-1" || event.ItemID != "run-1:plan" || event.Phase != "commentary" {
		t.Fatalf("event semantics = %#v, want turn-scoped plan commentary", event)
	}
	if len(event.ACP.Plan) != 2 {
		t.Fatalf("plan = %#v, want two entries", event.ACP.Plan)
	}
	if event.ACP.Plan[0].Content != "读取 README" || event.ACP.Plan[0].Status != "completed" || event.ACP.Plan[0].Priority != "high" {
		t.Fatalf("plan[0] = %#v, want structured completed entry", event.ACP.Plan[0])
	}
	if event.ACP.Plan[1].Content != "写入新章节" || event.ACP.Plan[1].Status != "in_progress" || event.ACP.Plan[1].Priority != "medium" {
		t.Fatalf("plan[1] = %#v, want structured in_progress entry", event.ACP.Plan[1])
	}
}

func TestBuildACPPromptUsesFileNativeProjectGuidance(t *testing.T) {
	prompt := buildACPPrompt(agentRunRequest{
		ProjectID: "project-safe",
		Document:  &agentDocumentContext{ID: "doc-1", Title: "第一集", Content: "# 第一集"},
	})

	if !strings.Contains(prompt, "当前工作目录已经是当前项目的文档根目录") ||
		!strings.Contains(prompt, "文档读写、创建、移动和删除优先直接操作当前工作目录 `.` 下的 Markdown 文件") ||
		!strings.Contains(prompt, "不要再访问或创建 `work/` 子目录") ||
		!strings.Contains(prompt, "长文档生成要分批落盘") ||
		!strings.Contains(prompt, "不要一次性把整篇内容塞进单个 `write` / `edit` 工具参数") ||
		!strings.Contains(prompt, "每次写入参数要小") ||
		!strings.Contains(prompt, "二级标题分镜组为一批") ||
		!strings.Contains(prompt, "这是一个创作工作区，不是软件开发工作区") ||
		!strings.Contains(prompt, "不要编写、修改或生成程序代码、脚本、依赖配置或工程文件") ||
		!strings.Contains(prompt, "优先使用运行时自带的文件/命令能力或 MediaGo Drama MCP 工具完成") {
		t.Fatalf("prompt = %q, want file-native project guidance", prompt)
	}
	if strings.Contains(prompt, "ls work") || strings.Contains(prompt, "读取 `work/` 下") {
		t.Fatalf("prompt = %q, should not steer agents toward nested work directory", prompt)
	}
	if strings.Contains(prompt, "当前项目 ID：project-safe") ||
		strings.Contains(prompt, "不得操作其他项目的文档") ||
		strings.Contains(prompt, "# 第一集") {
		t.Fatalf("prompt = %q, should not inline project id or document content", prompt)
	}
}

func TestBuildACPPromptDoesNotInlineToolUsageCatalog(t *testing.T) {
	prompt := buildACPPrompt(agentRunRequest{
		ProjectID: "project-safe",
		Document:  &agentDocumentContext{ID: "doc-1", Title: "第一集", Content: "# 第一集"},
	})

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
		"set_document_title",
		"set_document_category",
		"set_document_parent",
		"set_document_tags",
	} {
		if strings.Contains(prompt, toolName) {
			t.Fatalf("prompt = %q, should not inline tool usage for %q", prompt, toolName)
		}
	}
	if strings.Contains(prompt, mediaGoDramaMCPServerName+"/") {
		t.Fatalf("prompt = %q, should not expose MCP namespace prefix", prompt)
	}
	if strings.Contains(prompt, "mcp__"+mediaGoDramaMCPServerName+"__") {
		t.Fatalf("prompt = %q, should not expose Codex internal MCP namespace", prompt)
	}
	if strings.Contains(prompt, "documentToolCalls") {
		t.Fatalf("prompt = %q, should not promote documentToolCalls fallback JSON", prompt)
	}
}

func TestBuildACPPromptDoesNotInlineInjectedSystemOrUserPrompt(t *testing.T) {
	prompt := buildACPPrompt(agentRunRequest{
		Prompt:       "生成两个镜头",
		SystemPrompt: "你当前绑定的角色是「分镜师」。\n请按镜头输出。",
		Document:     &agentDocumentContext{ID: "doc-1", Title: "第一集", Content: "# 第一集"},
	})

	if strings.Contains(prompt, "你当前绑定的角色是「分镜师」。") ||
		strings.Contains(prompt, "生成两个镜头") ||
		strings.Contains(prompt, "用户请求：") {
		t.Fatalf("prompt = %q, should not inline injected system prompt or user prompt", prompt)
	}
	if !strings.Contains(prompt, "你是 MediaGo Drama 的项目 Agent。") {
		t.Fatalf("prompt = %q, want fixed agent instruction", prompt)
	}
	if !strings.Contains(prompt, "# 工具使用原则") ||
		!strings.Contains(prompt, "- 使用中文回复用户。") ||
		!strings.Contains(prompt, "不要根据本机可用命令、Skills、MCP、环境变量或工具描述中的 Ark") {
		t.Fatalf("prompt = %q, want general tool principles preserved", prompt)
	}
	if strings.Contains(prompt, "get_document") || strings.Contains(prompt, "replace_section") {
		t.Fatalf("prompt = %q, should not inline concrete document tool usage", prompt)
	}
}

func TestPreferredPermissionOption(t *testing.T) {
	options := []acp.PermissionOption{
		{Kind: acp.PermissionOptionKindRejectOnce, OptionId: "reject"},
		{Kind: acp.PermissionOptionKindAllowOnce, OptionId: "allow"},
	}

	option := PreferredPermissionOption(options)
	if option == nil || option.OptionId != "allow" {
		t.Fatalf("option = %#v, want allow once", option)
	}
}

func TestACPClientRequestPermissionWaitsForDecision(t *testing.T) {
	events := make(chan agentEvent, 4)
	client := &acpClient{
		publish: func(event agentEvent) {
			events <- event
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resultCh := make(chan acp.RequestPermissionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		response, err := client.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: "session-1",
			ToolCall: acp.ToolCallUpdate{
				ToolCallId: "call-edit",
				Title:      acp.Ptr("写入 README"),
			},
			Options: []acp.PermissionOption{
				{Kind: acp.PermissionOptionKindAllowOnce, Name: "Allow once", OptionId: "allow-once"},
				{Kind: acp.PermissionOptionKindRejectOnce, Name: "Reject", OptionId: "reject"},
			},
		})
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- response
	}()

	requestID := waitForPermissionRequestEvent(t, events).RequestID
	waitForPermissionUIEvent(t, events, requestID)
	pending := client.PendingPermissions()
	if len(pending) != 1 || pending[0].RequestID != requestID || pending[0].ToolCall == nil || pending[0].ToolCall.Title != "写入 README" {
		t.Fatalf("pending = %#v, want visible permission request", pending)
	}
	runner := &acpAgentRunner{}
	runner.activeClients.Store("session-1", client)
	if runnerPending := runner.PendingPermissions("session-1"); len(runnerPending) != 1 || runnerPending[0].RequestID != requestID {
		t.Fatalf("runner pending = %#v, want request %s", runnerPending, requestID)
	}
	if err := client.ResolvePermission(requestID, "allow-once", false); err != nil {
		t.Fatalf("ResolvePermission returned error: %v", err)
	}
	if pending := client.PendingPermissions(); len(pending) != 0 {
		t.Fatalf("pending after resolve = %#v, want empty", pending)
	}

	select {
	case err := <-errCh:
		t.Fatalf("RequestPermission returned error: %v", err)
	case response := <-resultCh:
		if response.Outcome.Selected == nil || response.Outcome.Selected.OptionId != "allow-once" {
			t.Fatalf("response = %#v, want selected allow-once", response)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for RequestPermission")
	}
}

func TestACPClientRequestPermissionCanBeCancelled(t *testing.T) {
	events := make(chan agentEvent, 4)
	client := &acpClient{
		publish: func(event agentEvent) {
			events <- event
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resultCh := make(chan acp.RequestPermissionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		response, err := client.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: "session-1",
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "call-delete"},
			Options: []acp.PermissionOption{
				{Kind: acp.PermissionOptionKindRejectOnce, Name: "Reject", OptionId: "reject"},
			},
		})
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- response
	}()

	requestID := waitForPermissionRequestEvent(t, events).RequestID
	if pending := client.PendingPermissions(); len(pending) != 1 || pending[0].RequestID != requestID {
		t.Fatalf("pending = %#v, want request %s", pending, requestID)
	}
	if err := client.ResolvePermission(requestID, "", true); err != nil {
		t.Fatalf("ResolvePermission returned error: %v", err)
	}
	if pending := client.PendingPermissions(); len(pending) != 0 {
		t.Fatalf("pending after cancel = %#v, want empty", pending)
	}

	select {
	case err := <-errCh:
		t.Fatalf("RequestPermission returned error: %v", err)
	case response := <-resultCh:
		if response.Outcome.Cancelled == nil {
			t.Fatalf("response = %#v, want cancelled outcome", response)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for RequestPermission")
	}
}

func TestACPClientCancelPendingPermissionsClearsVisibleRequests(t *testing.T) {
	client := &acpClient{}
	decisionCh := make(chan permissionDecision, 1)
	client.pendingPermissions.Store("permission-1", decisionCh)
	client.pendingRequests.Store("permission-1", AgentACPPermissionRequest{
		RequestID: "permission-1",
		Options: []AgentACPPermissionOption{
			{OptionID: "reject", Kind: "reject_once", Name: "Reject"},
		},
	})

	client.cancelPendingPermissions()

	if pending := client.PendingPermissions(); len(pending) != 0 {
		t.Fatalf("pending = %#v, want empty after cancel", pending)
	}
	select {
	case decision := <-decisionCh:
		if !decision.Cancelled {
			t.Fatalf("decision = %#v, want cancelled", decision)
		}
	default:
		t.Fatal("cancelPendingPermissions did not notify pending decision channel")
	}
}

func waitForPermissionRequestEvent(t *testing.T, events <-chan agentEvent) *AgentACPPermissionRequest {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type != "agent.acp" || event.ACP == nil || event.ACP.PermissionRequest == nil {
				continue
			}
			if event.ACP.Kind != "permissionRequest" {
				t.Fatalf("kind = %q, want permissionRequest", event.ACP.Kind)
			}
			if event.ACP.PermissionRequest.RequestID == "" {
				t.Fatal("permission request id is empty")
			}
			return event.ACP.PermissionRequest
		case <-timeout:
			t.Fatal("timed out waiting for permission request event")
		}
	}
}

func waitForPermissionUIEvent(t *testing.T, events <-chan agentEvent, requestID string) {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type != AgentUIEventType || event.A2UI == nil {
				continue
			}
			if !strings.Contains(event.A2UI.SurfaceID, requestID) {
				t.Fatalf("surfaceId = %q, want request id %q", event.A2UI.SurfaceID, requestID)
			}
			return
		case <-timeout:
			t.Fatal("timed out waiting for permission UI event")
		}
	}
}

func buildACPPrompt(request agentRunRequest) string {
	return BuildACPPrompt(request, PromptBuildOptions{})
}
