package settings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm"
)

type memoryAgentModelProfileStore struct {
	values map[string]domainAgentModelProfile
}

func (store *memoryAgentModelProfileStore) ListAgentModelProfiles() ([]domainAgentModelProfile, error) {
	result := make([]domainAgentModelProfile, 0, len(store.values))
	for _, value := range store.values {
		result = append(result, value)
	}
	return result, nil
}

func (store *memoryAgentModelProfileStore) GetAgentModelProfile(id string) (domainAgentModelProfile, error) {
	value, ok := store.values[strings.TrimSpace(id)]
	if !ok {
		return domainAgentModelProfile{}, gorm.ErrRecordNotFound
	}
	return value, nil
}

func (store *memoryAgentModelProfileStore) UpsertAgentModelProfile(model domainAgentModelProfile) error {
	store.values[model.ID] = model
	return nil
}

func (store *memoryAgentModelProfileStore) DeleteAgentModelProfile(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return false, nil
	}
	delete(store.values, id)
	return true, nil
}

func (store *memoryAgentModelProfileStore) ClearAgentModelProfileDefaults() error {
	for id, value := range store.values {
		value.IsDefault = false
		store.values[id] = value
	}
	return nil
}

func (store *memoryAgentModelProfileStore) SetAgentModelProfileDefault(id string) error {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return gorm.ErrRecordNotFound
	}
	for profileID, value := range store.values {
		value.IsDefault = profileID == id
		store.values[profileID] = value
	}
	return nil
}

func TestAgentModelProfilesCRUDDefaultAndKeyRedaction(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	ctx := context.Background()

	templateID := "minimax"
	list, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &templateID})
	if err != nil {
		t.Fatalf("CreateAgentModelProfile minimax returned error: %v", err)
	}
	if list.DefaultProfileID != "minimax-cn" {
		t.Fatalf("defaultProfileId = %q, want minimax-cn", list.DefaultProfileID)
	}
	minimax := agentProfileByID(t, list, "minimax-cn")
	if !minimax.IsDefault || !minimax.Enabled || minimax.APIKey.Configured {
		t.Fatalf("minimax profile = %#v, want enabled default without configured key", minimax)
	}
	if minimax.BaseURL != "https://api.minimaxi.com/v1" {
		t.Fatalf("minimax baseURL = %q, want domestic endpoint", minimax.BaseURL)
	}
	if minimax.ProviderID != "minimax-cn" || minimax.ProviderLabel != "MiniMax 国内" {
		t.Fatalf("minimax provider = (%q, %q), want domestic provider", minimax.ProviderID, minimax.ProviderLabel)
	}

	list, err = settings.SetAgentModelProfileAPIKey(ctx, "minimax-cn", "  sk-minimax-secret  ")
	if err != nil {
		t.Fatalf("SetAgentModelProfileAPIKey returned error: %v", err)
	}
	minimax = agentProfileByID(t, list, "minimax-cn")
	if !minimax.APIKey.Configured || minimax.APIKey.Source != "settings" || minimax.APIKey.Masked == "" {
		t.Fatalf("minimax key status = %#v, want redacted configured key", minimax.APIKey)
	}
	if strings.Contains(minimax.APIKey.Masked, "secret") {
		t.Fatalf("masked key %q should not expose the secret suffix", minimax.APIKey.Masked)
	}

	if _, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &templateID}); !errors.Is(err, ErrAgentModelConflict) {
		t.Fatalf("duplicate CreateAgentModelProfile error = %v, want ErrAgentModelConflict", err)
	}

	deepseekTemplateID := "deepseek"
	makeDefault := true
	list, err = settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &deepseekTemplateID, IsDefault: &makeDefault})
	if err != nil {
		t.Fatalf("CreateAgentModelProfile deepseek returned error: %v", err)
	}
	if list.DefaultProfileID != "deepseek" {
		t.Fatalf("defaultProfileId = %q, want deepseek", list.DefaultProfileID)
	}
	if agentProfileByID(t, list, "minimax-cn").IsDefault {
		t.Fatal("minimax should no longer be default")
	}

	list, err = settings.ClearAgentModelProfileAPIKey(ctx, "minimax-cn")
	if err != nil {
		t.Fatalf("ClearAgentModelProfileAPIKey returned error: %v", err)
	}
	if agentProfileByID(t, list, "minimax-cn").APIKey.Configured {
		t.Fatal("minimax key should be unconfigured after clear")
	}

	list, err = settings.DeleteAgentModelProfile(ctx, "deepseek")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile default returned error: %v", err)
	}
	if list.DefaultProfileID != "minimax-cn" || !agentProfileByID(t, list, "minimax-cn").IsDefault {
		t.Fatalf("after deleting default response = %#v, want minimax promoted", list)
	}

	list, err = settings.DeleteAgentModelProfile(ctx, "minimax-cn")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile last returned error: %v", err)
	}
	if list.DefaultProfileID != "" || len(list.Profiles) != 0 {
		t.Fatalf("after deleting last response = %#v, want no default and no profiles", list)
	}
}

func TestPrepareOpenCodeRuntimeConfigWritesSchemaAndEnvWithoutSecrets(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	ctx := context.Background()

	if _, err := settings.SetAPIKey(ctx, "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	assertContentAddressedOpenCodeConfigDir(t, workspaceDir, config.ConfigDir)
	if config.ProfileCount <= 1 || config.DefaultProfileID != "openrouter-gpt-5-5" {
		t.Fatalf("runtime config = %#v, want openrouter catalog profiles", config)
	}
	if !config.RestrictModelValues || !stringSliceContains(config.AllowedModelValues, "openrouter/openai/gpt-5.5") {
		t.Fatalf("allowed model values = %#v, want openrouter runtime profile whitelist", config.AllowedModelValues)
	}
	if !stringSliceContains(config.AllowedModelValues, "openrouter/google/gemini-3.5-flash") {
		t.Fatalf("allowed model values = %#v, want OpenRouter Gemini agent model", config.AllowedModelValues)
	}
	if !stringSliceContains(config.AllowedModelProviders, "openrouter") {
		t.Fatalf("allowed model providers = %#v, want openrouter provider whitelist", config.AllowedModelProviders)
	}
	envName := AgentModelProfileEnvName("openrouter-gpt-5-5")
	if config.Env[envName] != "sk-openrouter-secret" {
		t.Fatalf("runtime env %q = %q, want secret in process env only", envName, config.Env[envName])
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	text := string(data)
	if strings.Contains(text, "sk-openrouter-secret") {
		t.Fatalf("opencode.json should not contain real API key: %s", text)
	}
	for _, want := range []string{
		`"$schema": "https://opencode.ai/config.json"`,
		`"model": "openrouter/openai/gpt-5.5"`,
		`"google/gemini-3.5-flash"`,
		`"apiKey": "{env:MEDIAGO_AGENT_MODEL_OPENROUTER_GPT_5_5_API_KEY}"`,
		`"tool_call": true`,
		`"attachment": true`,
		`"input": [`,
		`"image"`,
		`"temperature": 0`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("opencode.json missing %q:\n%s", want, text)
		}
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("opencode.json is invalid json: %v", err)
	}
}

func TestPrepareOpenCodeRuntimeConfigWritesManagedInstructions(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	ctx := context.Background()
	if _, err := settings.SetAPIKey(ctx, "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	fixedInstructions := "# MediaGo 固定指令\n\n仅使用受管文档工具。\n"
	config, err := settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
		ctx,
		workspaceDir,
		"openrouter/openai/gpt-4.1-mini",
		fixedInstructions,
	)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfigForModelAndInstructions returned error: %v", err)
	}

	assertContentAddressedOpenCodeConfigDir(t, workspaceDir, config.ConfigDir)
	assertPrivateDirectory(t, config.ConfigDir)

	configData, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	assertPrivateFile(t, filepath.Join(config.ConfigDir, "opencode.json"))
	var rendered struct {
		Instructions []string `json:"instructions"`
	}
	if err := json.Unmarshal(configData, &rendered); err != nil {
		t.Fatalf("unmarshalling opencode.json: %v", err)
	}
	if len(rendered.Instructions) != 1 {
		t.Fatalf("instructions = %#v, want one managed instruction file", rendered.Instructions)
	}

	instructionPath := rendered.Instructions[0]
	wantInstructionPath := filepath.Join(config.ConfigDir, "instructions", "mediago-drama.md")
	if instructionPath != wantInstructionPath {
		t.Fatalf("instruction path = %q, want %q", instructionPath, wantInstructionPath)
	}
	if !filepath.IsAbs(instructionPath) {
		t.Fatalf("instruction path = %q, want absolute path", instructionPath)
	}
	assertPathWithinDirectory(t, config.ConfigDir, instructionPath)
	assertPrivateDirectory(t, filepath.Dir(instructionPath))

	instructionData, err := os.ReadFile(instructionPath)
	if err != nil {
		t.Fatalf("reading managed instruction file: %v", err)
	}
	if got := string(instructionData); got != fixedInstructions {
		t.Fatalf("managed instructions = %q, want %q", got, fixedInstructions)
	}
	assertPrivateFile(t, instructionPath)

	if strings.Contains(string(configData), "仅使用受管文档工具") {
		t.Fatalf("opencode.json should reference the managed file instead of inlining instructions:\n%s", configData)
	}
}

func TestPrepareOpenCodeRuntimeConfigWritesInstructionsWithoutProfiles(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)

	workspaceDir := t.TempDir()
	fixedInstructions := "# MediaGo 固定指令\n\n即使没有模型 profile 也必须加载。\n"
	config, err := settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
		context.Background(),
		workspaceDir,
		"",
		fixedInstructions,
	)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfigForModelAndInstructions returned error: %v", err)
	}

	assertContentAddressedOpenCodeConfigDir(t, workspaceDir, config.ConfigDir)
	if config.ProfileCount != 0 || config.DefaultProfileID != "" || len(config.Env) != 0 || len(config.AllowedModelValues) != 0 || len(config.AllowedModelProviders) != 0 {
		t.Fatalf("runtime config = %#v, want instructions with an empty model catalog", config)
	}
	if !config.RestrictModelValues {
		t.Fatal("RestrictModelValues = false, want true without profiles")
	}

	configData, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json without profiles: %v", err)
	}
	var rendered struct {
		Schema       string   `json:"$schema"`
		Model        string   `json:"model"`
		Instructions []string `json:"instructions"`
		Provider     any      `json:"provider"`
	}
	if err := json.Unmarshal(configData, &rendered); err != nil {
		t.Fatalf("unmarshalling opencode.json without profiles: %v", err)
	}
	if rendered.Schema != opencodeConfigSchema || rendered.Model != "" || rendered.Provider != nil {
		t.Fatalf("opencode config = %#v, want schema and instructions only", rendered)
	}
	if len(rendered.Instructions) != 1 || !filepath.IsAbs(rendered.Instructions[0]) {
		t.Fatalf("instructions = %#v, want one absolute managed path", rendered.Instructions)
	}
	assertPathWithinDirectory(t, config.ConfigDir, rendered.Instructions[0])
	instructionData, err := os.ReadFile(rendered.Instructions[0])
	if err != nil {
		t.Fatalf("reading managed instruction file without profiles: %v", err)
	}
	if got := string(instructionData); got != fixedInstructions {
		t.Fatalf("managed instructions = %q, want %q", got, fixedInstructions)
	}
	assertPrivateFile(t, rendered.Instructions[0])
	if strings.Contains(string(configData), "即使没有模型 profile 也必须加载") {
		t.Fatalf("opencode.json should not inline managed instructions:\n%s", configData)
	}
}

func TestPrepareOpenCodeRuntimeConfigPrefersSelectedModel(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	ctx := context.Background()

	if _, err := settings.SetAPIKey(ctx, "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := settings.PrepareOpenCodeRuntimeConfigForModel(ctx, workspaceDir, "openrouter/openai/gpt-4.1-mini")
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfigForModel returned error: %v", err)
	}
	if config.DefaultProfileID != "openrouter-gpt-4-1-mini" {
		t.Fatalf("DefaultProfileID = %q, want selected model profile", config.DefaultProfileID)
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	if text := string(data); !strings.Contains(text, `"model": "openrouter/openai/gpt-4.1-mini"`) {
		t.Fatalf("opencode.json = %s, want selected model as default", text)
	}
}

func TestPrepareOpenCodeRuntimeConfigUsesImmutableContentAddressedDirectories(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	workspaceDir := t.TempDir()

	firstInstructions := "# MediaGo\n\n第一版固定指令。\n"
	first, err := settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
		context.Background(), workspaceDir, "", firstInstructions,
	)
	if err != nil {
		t.Fatalf("preparing first config: %v", err)
	}
	second, err := settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
		context.Background(), workspaceDir, "", "# MediaGo\n\n第二版固定指令。\n",
	)
	if err != nil {
		t.Fatalf("preparing second config: %v", err)
	}
	firstAgain, err := settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
		context.Background(), workspaceDir, "", firstInstructions,
	)
	if err != nil {
		t.Fatalf("preparing first config again: %v", err)
	}

	if first.ConfigDir == second.ConfigDir {
		t.Fatalf("different instructions reused ConfigDir %q", first.ConfigDir)
	}
	if firstAgain.ConfigDir != first.ConfigDir {
		t.Fatalf("same rendered content ConfigDir = %q, want %q", firstAgain.ConfigDir, first.ConfigDir)
	}
	assertManagedOpenCodeInstructions(t, first.ConfigDir, firstInstructions)
	assertManagedOpenCodeInstructions(t, second.ConfigDir, "# MediaGo\n\n第二版固定指令。\n")
}

func TestPrepareOpenCodeRuntimeConfigConcurrentVariantsDoNotOverwrite(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	if _, err := settings.SetAPIKey(context.Background(), "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}
	workspaceDir := t.TempDir()
	type request struct {
		model        string
		instructions string
	}
	type result struct {
		config OpenCodeRuntimeConfig
		err    error
	}
	requests := []request{
		{model: "openrouter/openai/gpt-4.1-mini", instructions: "并发指令 A\n"},
		{model: "openrouter/openai/gpt-5.5", instructions: "并发指令 B\n"},
	}
	results := make([]result, len(requests))
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for index := range requests {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			<-start
			request := requests[index]
			results[index].config, results[index].err = settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
				context.Background(), workspaceDir, request.model, request.instructions,
			)
		}(index)
	}
	close(start)
	waitGroup.Wait()

	for index, result := range results {
		if result.err != nil {
			t.Fatalf("preparing concurrent config %d: %v", index, result.err)
		}
		assertContentAddressedOpenCodeConfigDir(t, workspaceDir, result.config.ConfigDir)
		assertManagedOpenCodeInstructions(t, result.config.ConfigDir, requests[index].instructions)
		configData, err := os.ReadFile(filepath.Join(result.config.ConfigDir, "opencode.json"))
		if err != nil {
			t.Fatalf("reading concurrent config %d: %v", index, err)
		}
		if !strings.Contains(string(configData), `"model": "`+requests[index].model+`"`) {
			t.Fatalf("concurrent config %d = %s, want model %q", index, configData, requests[index].model)
		}
	}
	if results[0].config.ConfigDir == results[1].config.ConfigDir {
		t.Fatalf("concurrent variants reused ConfigDir %q", results[0].config.ConfigDir)
	}

	root := openCodeConfigRootForTest(workspaceDir)
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("reading OpenCode config root: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".tmp-") {
			t.Fatalf("staging directory %q remained after publish", entry.Name())
		}
	}
}

func TestPrepareOpenCodeRuntimeConfigConcurrentIdenticalContentPublishesOnce(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	workspaceDir := t.TempDir()
	const instructions = "所有并发请求都使用同一份固定指令。\n"
	const callerCount = 8
	type result struct {
		config OpenCodeRuntimeConfig
		err    error
	}
	results := make([]result, callerCount)
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for index := range results {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			<-start
			results[index].config, results[index].err = settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
				context.Background(), workspaceDir, "", instructions,
			)
		}(index)
	}
	close(start)
	waitGroup.Wait()

	wantConfigDir := ""
	for index, result := range results {
		if result.err != nil {
			t.Fatalf("preparing identical concurrent config %d: %v", index, result.err)
		}
		if index == 0 {
			wantConfigDir = result.config.ConfigDir
		} else if result.config.ConfigDir != wantConfigDir {
			t.Fatalf("identical concurrent config %d ConfigDir = %q, want %q", index, result.config.ConfigDir, wantConfigDir)
		}
	}
	assertManagedOpenCodeInstructions(t, wantConfigDir, instructions)
	entries, err := os.ReadDir(openCodeConfigRootForTest(workspaceDir))
	if err != nil {
		t.Fatalf("reading OpenCode config root: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(wantConfigDir) {
		t.Fatalf("published config entries = %#v, want only %q", entries, filepath.Base(wantConfigDir))
	}
}

func TestPrepareOpenCodeRuntimeConfigExcludesDMXWhenPlatformDisabled(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	ctx := context.Background()

	if _, err := settings.SetAPIKey(ctx, "dmx", "sk-dmx-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	if config.ProfileCount != 0 || config.DefaultProfileID != "" || config.ConfigDir != "" || len(config.Env) != 0 || len(config.AllowedModelValues) != 0 || len(config.AllowedModelProviders) != 0 {
		t.Fatalf("runtime config = %#v, want no dmx agent runtime profile", config)
	}
	if !config.RestrictModelValues {
		t.Fatalf("RestrictModelValues = false, want true when no runtime profiles are configured")
	}
}

func TestPrepareOpenCodeRuntimeConfigIncludesDMXAPIWhenPlatformEnabled(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformDMXAPI})
	ctx := context.Background()

	if _, err := settings.SetAPIKey(ctx, "dmx", "sk-dmx-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	if config.ProfileCount == 0 || config.DefaultProfileID != "dmxapi-gpt-4-1-mini" {
		t.Fatalf("runtime config = %#v, want dmxapi catalog profiles", config)
	}
	if !config.RestrictModelValues || !stringSliceContains(config.AllowedModelValues, "dmxapi/gpt-4.1-mini") {
		t.Fatalf("allowed model values = %#v, want dmxapi runtime profile whitelist", config.AllowedModelValues)
	}
	if !stringSliceContains(config.AllowedModelProviders, "dmxapi") {
		t.Fatalf("allowed model providers = %#v, want dmxapi provider whitelist", config.AllowedModelProviders)
	}
	if config.Env[AgentModelProfileEnvName("dmxapi-gpt-4-1-mini")] != "sk-dmx-secret" {
		t.Fatalf("runtime env = %#v, want DMX key injected for dmxapi", config.Env)
	}
	for _, wanted := range []string{
		"dmxapi/gemini-3.5-flash",
		"dmxapi/gemini-3.1-pro-preview",
		"dmxapi/gemini-3.1-flash-lite",
	} {
		if !stringSliceContains(config.AllowedModelValues, wanted) {
			t.Fatalf("allowed model values = %#v, want Gemini agent model %q", config.AllowedModelValues, wanted)
		}
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	text := string(data)
	for _, want := range []string{
		`"model": "dmxapi/gpt-4.1-mini"`,
		`"baseURL": "https://www.dmxapi.cn/v1"`,
		`"name": "gpt-4.1-mini"`,
		`"gemini-3.5-flash"`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("opencode.json missing %q:\n%s", want, text)
		}
	}
}

func TestPrepareOpenCodeRuntimeConfigUsesMediagoUserModelsWhenAvailable(t *testing.T) {
	var sawAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/models/user" {
			t.Fatalf("request path = %q, want /api/v1/models/user", request.URL.Path)
		}
		sawAuthorization = request.Header.Get("Authorization")
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"data": [
				{
					"id": "local/gpt-test",
					"name": "GPT Test",
					"architecture": {
						"input_modalities": ["text", "image"],
						"output_modalities": ["text"]
					},
					"supported_parameters": ["stream", "tools"],
					"top_provider": {
						"context_length": 123456,
						"max_completion_tokens": 4096
					}
				},
				{
					"id": "local/text-test",
					"name": "Text Test",
					"kind": "text",
					"tags": ["text", "chat"],
					"categories": ["text", "chat"],
					"architecture": {
						"input_modalities": ["text"],
						"output_modalities": ["text"]
					},
					"supported_parameters": ["stream", "temperature"]
					},
					{
						"id": "local/gemini-test",
						"name": "Gemini Test",
						"kind": "text",
						"tags": ["text", "chat", "gemini"],
						"categories": ["text", "chat"],
						"architecture": {
							"input_modalities": ["text"],
							"output_modalities": ["text"]
						},
						"supported_parameters": ["stream", "tools"]
					},
					{
						"id": "local/disabled-gpt",
						"name": "Disabled GPT",
						"kind": "text",
						"enabled": false,
						"tags": ["text", "chat", "gpt"],
						"categories": ["text", "chat"],
						"architecture": {
							"input_modalities": ["text"],
							"output_modalities": ["text"]
						}
					},
					{
						"id": "local/hidden-gemini",
						"name": "Hidden Gemini",
						"kind": "text",
						"status": "hidden",
						"tags": ["text", "chat", "gemini"],
						"categories": ["text", "chat"],
						"architecture": {
							"input_modalities": ["text"],
							"output_modalities": ["text"]
						}
					},
					{
						"id": "local/image-test",
						"architecture": {
							"input_modalities": ["text"],
						"output_modalities": ["image"]
					}
				},
				{
					"id": "local/foo-task",
					"name": "Foo Task",
					"kind": "text",
					"tags": ["text"],
					"categories": ["text"],
					"architecture": {
						"input_modalities": ["text"],
						"output_modalities": ["text"]
					}
				},
				{
					"id": "local/image-output-test",
					"name": "Image Output Test",
					"architecture": {
						"input_modalities": ["text"],
						"output_modalities": ["text", "image"]
					}
				},
				{
					"id": "local/audio-output-test",
					"name": "Audio Output Test",
					"architecture": {
						"input_modalities": ["text"],
						"output_modalities": ["audio"]
					}
				},
				{
					"id": "local/speech-input-test",
					"name": "Speech Input Test",
					"architecture": {
						"input_modalities": ["audio"],
						"output_modalities": ["text"]
					}
				},
				{
					"id": "qwen/qwen-mt-plus",
					"name": "Qwen MT Plus",
					"kind": "text",
					"tags": ["text", "translation", "subtitle"],
					"categories": ["text", "translation", "subtitle"],
					"architecture": {
						"input_modalities": ["text"],
						"output_modalities": ["text"]
					}
				}
			]
		}`))
	}))
	defer server.Close()

	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformMediago})
	settings.SetMediagoBaseURL(server.URL + "/api/v1")
	ctx := context.Background()
	if _, err := settings.SetAPIKey(ctx, "mediago", "mgak-secret"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	if sawAuthorization != "Bearer mgak-secret" {
		t.Fatalf("Authorization = %q, want bearer key", sawAuthorization)
	}
	if config.ProfileCount != 3 || config.DefaultProfileID != "mediago-local-gpt-test" {
		t.Fatalf("runtime config = %#v, want dynamic MediaGo text profiles", config)
	}
	if !config.RestrictModelValues || !stringSliceContains(config.AllowedModelValues, "mediago/local/gpt-test") {
		t.Fatalf("allowed model values = %#v, want MediaGo dynamic runtime profile whitelist", config.AllowedModelValues)
	}
	if !stringSliceContains(config.AllowedModelValues, "mediago/local/gemini-test") {
		t.Fatalf("allowed model values = %#v, want MediaGo Gemini runtime profile", config.AllowedModelValues)
	}
	if !stringSliceContains(config.AllowedModelProviders, "mediago") {
		t.Fatalf("allowed model providers = %#v, want MediaGo provider whitelist", config.AllowedModelProviders)
	}
	if config.Env[AgentModelProfileEnvName("mediago-local-gpt-test")] != "mgak-secret" {
		t.Fatalf("runtime env = %#v, want MediaGo key injected for dynamic profile", config.Env)
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	text := string(data)
	for _, want := range []string{
		`"model": "mediago/local/gpt-test"`,
		`"baseURL": "` + server.URL + `/api/v1"`,
		`"name": "GPT Test"`,
		`"local/gemini-test"`,
		`"name": "Gemini Test"`,
		`"image"`,
		`"context": 123456`,
		`"output": 4096`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("opencode.json missing %q:\n%s", want, text)
		}
	}
	for _, unwanted := range []string{
		"local/image-test",
		"local/foo-task",
		"local/image-output-test",
		"local/audio-output-test",
		"local/speech-input-test",
		"local/disabled-gpt",
		"Disabled GPT",
		"local/hidden-gemini",
		"Hidden Gemini",
		"qwen/qwen-mt-plus",
		"Qwen MT Plus",
	} {
		if strings.Contains(text, unwanted) {
			t.Fatalf("opencode.json should not include non-conversation MediaGo model %q:\n%s", unwanted, text)
		}
	}

	var rendered openCodeConfigFile
	if err := json.Unmarshal(data, &rendered); err != nil {
		t.Fatalf("unmarshalling opencode.json: %v", err)
	}
	mediagoProvider := rendered.Provider[agentModelProviderMediago]
	if !mediagoProvider.Models["local/gpt-test"].ToolCall {
		t.Fatalf("MediaGo model with tools support should enable tool_call:\n%s", text)
	}
	if mediagoProvider.Models["local/text-test"].ToolCall {
		t.Fatalf("MediaGo model without tools support should not enable tool_call:\n%s", text)
	}
	if !mediagoProvider.Models["local/gemini-test"].ToolCall {
		t.Fatalf("MediaGo Gemini model with tools support should enable tool_call:\n%s", text)
	}
}

func TestPrepareOpenCodeRuntimeConfigDoesNotFallbackToStaticMediagoModelsWhenUserModelsFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformMediago})
	settings.SetMediagoBaseURL(server.URL + "/api/v1")
	ctx := context.Background()
	if _, err := settings.SetAPIKey(ctx, "mediago", "invalid-key"); err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}

	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	if config.ProfileCount != 0 || config.DefaultProfileID != "" || config.ConfigDir != "" || len(config.Env) != 0 {
		t.Fatalf("runtime config = %#v, want no MediaGo profiles when user model list fails", config)
	}
}

func TestPrepareOpenCodeRuntimeConfigUsesLegacyOfficialProfileKey(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{
			AgentModelProfileAPIKeyName("openrouter"): "sk-legacy-openrouter-secret",
		}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})

	config, err := settings.PrepareOpenCodeRuntimeConfig(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}

	envName := AgentModelProfileEnvName("openrouter-gpt-5-5")
	if config.ProfileCount <= 1 || config.Env[envName] != "sk-legacy-openrouter-secret" {
		t.Fatalf("runtime config = %#v, want legacy official key fallback", config)
	}
}

func agentProfileByID(t *testing.T, list AgentModelProfilesResponse, id string) AgentModelProfile {
	t.Helper()
	for _, profile := range list.Profiles {
		if profile.ID == id {
			return profile
		}
	}
	t.Fatalf("profile %q not found in %#v", id, list.Profiles)
	return AgentModelProfile{}
}

func assertPrivateDirectory(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat directory %q: %v", path, err)
	}
	if !info.IsDir() {
		t.Fatalf("path %q is not a directory", path)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if got := info.Mode().Perm(); got != 0o700 {
		t.Fatalf("directory %q permissions = %#o, want 0700", path, got)
	}
}

func assertPrivateFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat file %q: %v", path, err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("path %q is not a regular file", path)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("file %q permissions = %#o, want 0600", path, got)
	}
}

func assertContentAddressedOpenCodeConfigDir(t *testing.T, workspaceDir string, configDir string) {
	t.Helper()
	root := openCodeConfigRootForTest(workspaceDir)
	assertPrivateDirectory(t, root)
	assertPathWithinDirectory(t, root, configDir)
	relative, err := filepath.Rel(root, configDir)
	if err != nil {
		t.Fatalf("resolving content-addressed config dir: %v", err)
	}
	if strings.Contains(relative, string(filepath.Separator)) || len(relative) != 64 || strings.Trim(relative, "0123456789abcdef") != "" {
		t.Fatalf("ConfigDir = %q, want one lowercase SHA-256 directory below %q", configDir, root)
	}
	assertPrivateDirectory(t, configDir)
}

func assertManagedOpenCodeInstructions(t *testing.T, configDir string, want string) {
	t.Helper()
	configData, err := os.ReadFile(filepath.Join(configDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading managed OpenCode config: %v", err)
	}
	assertPrivateFile(t, filepath.Join(configDir, "opencode.json"))
	var rendered struct {
		Instructions []string `json:"instructions"`
	}
	if err := json.Unmarshal(configData, &rendered); err != nil {
		t.Fatalf("unmarshalling managed OpenCode config: %v", err)
	}
	if len(rendered.Instructions) != 1 {
		t.Fatalf("instructions = %#v, want one managed instruction", rendered.Instructions)
	}
	data, err := os.ReadFile(rendered.Instructions[0])
	if err != nil {
		t.Fatalf("reading managed OpenCode instructions: %v", err)
	}
	if string(data) != want {
		t.Fatalf("managed OpenCode instructions = %q, want %q", data, want)
	}
	assertPrivateDirectory(t, filepath.Dir(rendered.Instructions[0]))
	assertPrivateFile(t, rendered.Instructions[0])
}

func openCodeConfigRootForTest(workspaceDir string) string {
	return filepath.Join(workspaceDir, ".mediago-drama", "runtime", "agents", "opencode", "config")
}

func assertPathWithinDirectory(t *testing.T, directory string, path string) {
	t.Helper()
	relative, err := filepath.Rel(directory, path)
	if err != nil {
		t.Fatalf("resolving %q relative to %q: %v", path, directory, err)
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		t.Fatalf("path %q escapes managed directory %q", path, directory)
	}
}
