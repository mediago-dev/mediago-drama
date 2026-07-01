package settings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
	if config.ConfigDir != filepath.Join(workspaceDir, ".mediago-drama", "runtime", "agents", "opencode", "config") {
		t.Fatalf("ConfigDir = %q, want workspace metadata config dir", config.ConfigDir)
	}
	if config.ProfileCount <= 1 || config.DefaultProfileID != "openrouter-gpt-5-5" {
		t.Fatalf("runtime config = %#v, want openrouter catalog profiles", config)
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
	if config.ProfileCount != 0 || config.DefaultProfileID != "" || config.ConfigDir != "" || len(config.Env) != 0 {
		t.Fatalf("runtime config = %#v, want no dmx agent runtime profile", config)
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
	if config.Env[AgentModelProfileEnvName("dmxapi-gpt-4-1-mini")] != "sk-dmx-secret" {
		t.Fatalf("runtime env = %#v, want DMX key injected for dmxapi", config.Env)
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
	if config.ProfileCount != 2 || config.DefaultProfileID != "mediago-local-gpt-test" {
		t.Fatalf("runtime config = %#v, want dynamic MediaGo text profiles", config)
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
