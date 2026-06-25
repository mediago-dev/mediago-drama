package settings

import (
	"context"
	"encoding/json"
	"errors"
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
	if config.ProfileCount != 1 || config.DefaultProfileID != "openrouter" {
		t.Fatalf("runtime config = %#v, want one openrouter default", config)
	}
	envName := AgentModelProfileEnvName("openrouter")
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
		`"model": "openrouter/openai/gpt-4.1-mini"`,
		`"apiKey": "{env:MEDIAGO_AGENT_MODEL_OPENROUTER_API_KEY}"`,
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

func TestPrepareOpenCodeRuntimeConfigIncludesDMXGeminiFromDMXKey(t *testing.T) {
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
	if config.ProfileCount != 1 || config.DefaultProfileID != "dmx" {
		t.Fatalf("runtime config = %#v, want one dmx default", config)
	}
	envName := AgentModelProfileEnvName("dmx")
	if config.Env[envName] != "sk-dmx-secret" {
		t.Fatalf("runtime env %q = %q, want secret in process env only", envName, config.Env[envName])
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	text := string(data)
	if strings.Contains(text, "sk-dmx-secret") {
		t.Fatalf("opencode.json should not contain real API key: %s", text)
	}
	for _, want := range []string{
		`"model": "dmx/gemini-3.1-pro-preview"`,
		`"dmx": {`,
		`"name": "DMX"`,
		`"baseURL": "https://www.dmxapi.cn/v1"`,
		`"apiKey": "{env:MEDIAGO_AGENT_MODEL_DMX_API_KEY}"`,
		`"gemini-3.1-pro-preview": {`,
		`"name": "Gemini 3.1 Pro Preview"`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("opencode.json missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, `"tool_call"`) {
		t.Fatalf("opencode.json should not enable tool calls for DMX Gemini until the provider path is verified:\n%s", text)
	}
}

func TestPrepareOpenCodeRuntimeConfigUsesLegacyOfficialProfileKey(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{
			AgentModelProfileAPIKeyName("openrouter"): "sk-legacy-openrouter-secret",
		}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)

	config, err := settings.PrepareOpenCodeRuntimeConfig(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}

	envName := AgentModelProfileEnvName("openrouter")
	if config.ProfileCount != 1 || config.Env[envName] != "sk-legacy-openrouter-secret" {
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
