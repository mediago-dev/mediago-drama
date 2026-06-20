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

	templateID := "openrouter"
	contextWindow := 128000
	maxOutputTokens := 8192
	temperature := 0.2
	if _, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{
		TemplateID:      &templateID,
		ContextWindow:   &contextWindow,
		MaxOutputTokens: &maxOutputTokens,
		Temperature:     &temperature,
	}); err != nil {
		t.Fatalf("CreateAgentModelProfile returned error: %v", err)
	}
	if _, err := settings.SetAgentModelProfileAPIKey(ctx, "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAgentModelProfileAPIKey returned error: %v", err)
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
		`"context": 128000`,
		`"output": 8192`,
		`"input": [`,
		`"image"`,
		`"temperature": 0.2`,
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

func TestPrepareOpenCodeRuntimeConfigEmitsReasoningForReasoningModels(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	ctx := context.Background()

	minimaxTemplateID := "minimax"
	if _, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &minimaxTemplateID}); err != nil {
		t.Fatalf("CreateAgentModelProfile minimax returned error: %v", err)
	}
	if _, err := settings.SetAgentModelProfileAPIKey(ctx, "minimax-cn", "sk-minimax-secret"); err != nil {
		t.Fatalf("SetAgentModelProfileAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	if config.DefaultProfileID != "minimax-cn" {
		t.Fatalf("DefaultProfileID = %q, want minimax-cn", config.DefaultProfileID)
	}

	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, `"reasoning": true`) {
		t.Fatalf("opencode.json should declare reasoning for minimax:\n%s", text)
	}

	var parsed openCodeConfigFile
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("opencode.json is invalid json: %v", err)
	}
	provider, ok := parsed.Provider["minimax-cn"]
	if !ok {
		t.Fatalf("opencode.json missing minimax-cn provider: %#v", parsed.Provider)
	}
	model, ok := provider.Models["MiniMax-M3"]
	if !ok {
		t.Fatalf("opencode.json missing MiniMax-M3 model: %#v", provider.Models)
	}
	if !model.Reasoning {
		t.Fatalf("minimax model reasoning = %v, want true", model.Reasoning)
	}

	list, err := settings.ListAgentModelProfiles(ctx)
	if err != nil {
		t.Fatalf("ListAgentModelProfiles returned error: %v", err)
	}
	minimax := agentProfileByID(t, list, "minimax-cn")
	if !minimax.SupportsReasoning {
		t.Fatalf("minimax profile supportsReasoning = false, want true")
	}
}

func TestPrepareOpenCodeRuntimeConfigOmitsReasoningForNonReasoningModels(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	ctx := context.Background()

	templateID := "openrouter"
	if _, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &templateID}); err != nil {
		t.Fatalf("CreateAgentModelProfile openrouter returned error: %v", err)
	}
	if _, err := settings.SetAgentModelProfileAPIKey(ctx, "openrouter", "sk-openrouter-secret"); err != nil {
		t.Fatalf("SetAgentModelProfileAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("PrepareOpenCodeRuntimeConfig returned error: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(config.ConfigDir, "opencode.json"))
	if err != nil {
		t.Fatalf("reading opencode.json: %v", err)
	}
	if strings.Contains(string(data), `"reasoning"`) {
		t.Fatalf("opencode.json should not declare reasoning for openrouter:\n%s", string(data))
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
