package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
	"gorm.io/gorm"
)

type domainAgentModelProfile = domain.AgentModelProfileModel

const (
	opencodeConfigSchema       = "https://opencode.ai/config.json"
	agentModelKeyPrefix        = "agent-model:"
	agentModelKeySuffix        = ":api-key"
	agentModelProviderDMX      = "dmx"
	agentModelProviderDeepSeek = "deepseek"
)

var (
	profileIDPattern   = regexp.MustCompile(`[^a-z0-9_-]+`)
	providerIDPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
	envNamePartPattern = regexp.MustCompile(`[^A-Z0-9]+`)
)

// AgentModelProfileAPIKeyStatus describes the redacted credential state for one profile.
type AgentModelProfileAPIKeyStatus struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"`
	Masked     string `json:"masked,omitempty"`
}

// AgentModelProfile describes one global ACP model profile.
type AgentModelProfile struct {
	ID               string                        `json:"id"`
	Name             string                        `json:"name"`
	ProviderID       string                        `json:"providerId"`
	ProviderLabel    string                        `json:"providerLabel"`
	BaseURL          string                        `json:"baseURL"`
	Model            string                        `json:"model"`
	ModelDisplayName string                        `json:"modelDisplayName"`
	Enabled          bool                          `json:"enabled"`
	IsDefault        bool                          `json:"isDefault"`
	SupportsImages   bool                          `json:"supportsImages"`
	SupportsTools    bool                          `json:"supportsTools"`
	ContextWindow    int                           `json:"contextWindow,omitempty"`
	MaxOutputTokens  int                           `json:"maxOutputTokens,omitempty"`
	Temperature      *float64                      `json:"temperature,omitempty"`
	APIKey           AgentModelProfileAPIKeyStatus `json:"apiKey"`
}

// AgentModelProfileTemplate is a built-in OpenAI-compatible profile starter.
type AgentModelProfileTemplate struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	ProviderID       string   `json:"providerId"`
	ProviderLabel    string   `json:"providerLabel"`
	BaseURL          string   `json:"baseURL"`
	Model            string   `json:"model"`
	ModelDisplayName string   `json:"modelDisplayName"`
	SupportsImages   bool     `json:"supportsImages"`
	SupportsTools    bool     `json:"supportsTools"`
	ContextWindow    int      `json:"contextWindow,omitempty"`
	MaxOutputTokens  int      `json:"maxOutputTokens,omitempty"`
	Temperature      *float64 `json:"temperature,omitempty"`
}

// AgentModelProfilesResponse is the settings payload for global ACP model profiles.
type AgentModelProfilesResponse struct {
	Profiles         []AgentModelProfile         `json:"profiles"`
	DefaultProfileID string                      `json:"defaultProfileId,omitempty"`
	Templates        []AgentModelProfileTemplate `json:"templates"`
}

// AgentModelProfileMutation updates or creates one profile.
type AgentModelProfileMutation struct {
	TemplateID       *string  `json:"templateId,omitempty"`
	Name             *string  `json:"name,omitempty"`
	ProviderID       *string  `json:"providerId,omitempty"`
	ProviderLabel    *string  `json:"providerLabel,omitempty"`
	BaseURL          *string  `json:"baseURL,omitempty"`
	Model            *string  `json:"model,omitempty"`
	ModelDisplayName *string  `json:"modelDisplayName,omitempty"`
	Enabled          *bool    `json:"enabled,omitempty"`
	IsDefault        *bool    `json:"isDefault,omitempty"`
	SupportsImages   *bool    `json:"supportsImages,omitempty"`
	SupportsTools    *bool    `json:"supportsTools,omitempty"`
	ContextWindow    *int     `json:"contextWindow,omitempty"`
	MaxOutputTokens  *int     `json:"maxOutputTokens,omitempty"`
	Temperature      *float64 `json:"temperature,omitempty"`
}

// OpenCodeRuntimeConfig is the generated process config for opencode ACP.
type OpenCodeRuntimeConfig struct {
	ConfigDir        string
	Env              map[string]string
	ProfileCount     int
	DefaultProfileID string
}

// ListAgentModelProfiles returns global ACP model profiles with redacted credential state.
func (service *Settings) ListAgentModelProfiles(ctx context.Context) (AgentModelProfilesResponse, error) {
	models, err := service.listAgentModelProfileModels()
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	return service.agentModelProfilesResponse(ctx, models)
}

// CreateAgentModelProfile creates one global ACP model profile.
func (service *Settings) CreateAgentModelProfile(ctx context.Context, input AgentModelProfileMutation) (AgentModelProfilesResponse, error) {
	models, err := service.listAgentModelProfileModels()
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	model := profileModelFromTemplate(inputTemplate(input.TemplateID))
	applyProfileMutation(&model, input, true)
	if err := validateAgentModelProfile(model); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	model.ID = profileIDFromProviderID(model.ProviderID)
	if model.ID == "" {
		return AgentModelProfilesResponse{}, fmt.Errorf("%w: providerId is invalid", ErrAgentModelInvalid)
	}
	for _, existing := range models {
		if strings.EqualFold(existing.ID, model.ID) || strings.EqualFold(existing.ProviderID, model.ProviderID) {
			return AgentModelProfilesResponse{}, ErrAgentModelConflict
		}
	}
	now := time.Now().UTC()
	model.CreatedAt = now
	model.UpdatedAt = now
	model.APIKeyName = AgentModelProfileAPIKeyName(model.ID)
	if len(models) == 0 && model.Enabled {
		model.IsDefault = true
	}
	if model.IsDefault && !model.Enabled {
		return AgentModelProfilesResponse{}, fmt.Errorf("%w: default profile must be enabled", ErrAgentModelInvalid)
	}
	if model.IsDefault {
		if err := service.agentProfiles.ClearAgentModelProfileDefaults(); err != nil {
			return AgentModelProfilesResponse{}, err
		}
	}
	if err := service.agentProfiles.UpsertAgentModelProfile(model); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if err := service.ensureAgentModelDefault(); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	return service.ListAgentModelProfiles(ctx)
}

// UpdateAgentModelProfile updates one global ACP model profile.
func (service *Settings) UpdateAgentModelProfile(ctx context.Context, id string, input AgentModelProfileMutation) (AgentModelProfilesResponse, error) {
	if service.agentProfiles == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	id = strings.TrimSpace(id)
	model, err := service.agentProfiles.GetAgentModelProfile(id)
	if isProfileNotFound(err) {
		return AgentModelProfilesResponse{}, ErrAgentModelNotFound
	}
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	applyProfileMutation(&model, input, false)
	if err := validateAgentModelProfile(model); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if model.IsDefault && !model.Enabled {
		return AgentModelProfilesResponse{}, fmt.Errorf("%w: default profile must be enabled", ErrAgentModelInvalid)
	}
	model.UpdatedAt = time.Now().UTC()
	if model.APIKeyName == "" {
		model.APIKeyName = AgentModelProfileAPIKeyName(model.ID)
	}
	models, err := service.listAgentModelProfileModels()
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	for _, existing := range models {
		if existing.ID != model.ID && strings.EqualFold(existing.ProviderID, model.ProviderID) {
			return AgentModelProfilesResponse{}, ErrAgentModelConflict
		}
	}
	if model.IsDefault {
		if err := service.agentProfiles.ClearAgentModelProfileDefaults(); err != nil {
			return AgentModelProfilesResponse{}, err
		}
	}
	if err := service.agentProfiles.UpsertAgentModelProfile(model); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if err := service.ensureAgentModelDefault(); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	return service.ListAgentModelProfiles(ctx)
}

// DeleteAgentModelProfile removes one global ACP model profile and its stored key.
func (service *Settings) DeleteAgentModelProfile(ctx context.Context, id string) (AgentModelProfilesResponse, error) {
	if service.agentProfiles == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	id = strings.TrimSpace(id)
	deleted, err := service.agentProfiles.DeleteAgentModelProfile(id)
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if !deleted {
		return AgentModelProfilesResponse{}, ErrAgentModelNotFound
	}
	if service.apiKeys != nil {
		if err := service.apiKeys.Clear(AgentModelProfileAPIKeyName(id)); err != nil {
			return AgentModelProfilesResponse{}, err
		}
	}
	if err := service.ensureAgentModelDefault(); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	return service.ListAgentModelProfiles(ctx)
}

// SetAgentModelProfileDefault selects one enabled global ACP model profile as the default.
func (service *Settings) SetAgentModelProfileDefault(ctx context.Context, id string) (AgentModelProfilesResponse, error) {
	if service.agentProfiles == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	profile, err := service.agentProfiles.GetAgentModelProfile(id)
	if isProfileNotFound(err) {
		return AgentModelProfilesResponse{}, ErrAgentModelNotFound
	}
	if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if !profile.Enabled {
		return AgentModelProfilesResponse{}, fmt.Errorf("%w: default profile must be enabled", ErrAgentModelInvalid)
	}
	if err := service.agentProfiles.SetAgentModelProfileDefault(profile.ID); err != nil {
		if isProfileNotFound(err) {
			return AgentModelProfilesResponse{}, ErrAgentModelNotFound
		}
		return AgentModelProfilesResponse{}, err
	}
	return service.ListAgentModelProfiles(ctx)
}

// SetAgentModelProfileAPIKey stores one global ACP model profile API key.
func (service *Settings) SetAgentModelProfileAPIKey(ctx context.Context, id string, value string) (AgentModelProfilesResponse, error) {
	if service.agentProfiles == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	id = strings.TrimSpace(id)
	if _, err := service.agentProfiles.GetAgentModelProfile(id); isProfileNotFound(err) {
		return AgentModelProfilesResponse{}, ErrAgentModelNotFound
	} else if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if strings.TrimSpace(value) == "" {
		return AgentModelProfilesResponse{}, ErrAPIKeyRequired
	}
	if service.apiKeys == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	if err := service.apiKeys.Set(AgentModelProfileAPIKeyName(id), value); err != nil {
		return AgentModelProfilesResponse{}, err
	}
	return service.ListAgentModelProfiles(ctx)
}

// ClearAgentModelProfileAPIKey removes one global ACP model profile API key.
func (service *Settings) ClearAgentModelProfileAPIKey(ctx context.Context, id string) (AgentModelProfilesResponse, error) {
	if service.agentProfiles == nil {
		return AgentModelProfilesResponse{}, ErrAgentModelStoreMissing
	}
	id = strings.TrimSpace(id)
	if _, err := service.agentProfiles.GetAgentModelProfile(id); isProfileNotFound(err) {
		return AgentModelProfilesResponse{}, ErrAgentModelNotFound
	} else if err != nil {
		return AgentModelProfilesResponse{}, err
	}
	if service.apiKeys != nil {
		if err := service.apiKeys.Clear(AgentModelProfileAPIKeyName(id)); err != nil {
			return AgentModelProfilesResponse{}, err
		}
	}
	return service.ListAgentModelProfiles(ctx)
}

// PrepareOpenCodeRuntimeConfig renders opencode config and resolves process env.
func (service *Settings) PrepareOpenCodeRuntimeConfig(ctx context.Context, workspaceDir string) (OpenCodeRuntimeConfig, error) {
	enabled, env, err := service.officialAgentRuntimeProfiles(ctx)
	if err != nil {
		return OpenCodeRuntimeConfig{}, err
	}
	if len(enabled) == 0 {
		return OpenCodeRuntimeConfig{}, nil
	}
	configDir := filepath.Join(shared.WorkspacePathsFor(workspaceDir).GlobalMetadataDir(), "runtime", "agents", "opencode", "config")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return OpenCodeRuntimeConfig{}, fmt.Errorf("creating opencode config directory: %w", err)
	}
	configPath := filepath.Join(configDir, "opencode.json")
	if err := writeOpenCodeConfig(configPath, renderOpenCodeConfig(enabled)); err != nil {
		return OpenCodeRuntimeConfig{}, err
	}
	return OpenCodeRuntimeConfig{
		ConfigDir:        configDir,
		Env:              env,
		ProfileCount:     len(enabled),
		DefaultProfileID: defaultProfileID(enabled),
	}, nil
}

func (service *Settings) officialAgentRuntimeProfiles(ctx context.Context) ([]domainAgentModelProfile, map[string]string, error) {
	_ = ctx
	env := map[string]string{}
	if service == nil || service.apiKeys == nil {
		return nil, env, nil
	}

	profiles := []domainAgentModelProfile{}
	for _, spec := range officialAgentModelProfileSpecs() {
		template := agentModelProfileTemplateByID(spec.TemplateID)
		if template.ID == "" {
			continue
		}
		profile := profileModelFromTemplate(template)
		value, err := service.agentRuntimeAPIKey(spec.CredentialKeyName, profile.ID)
		if err != nil {
			return nil, nil, err
		}
		if value == "" {
			continue
		}
		profile.IsDefault = len(profiles) == 0
		profiles = append(profiles, profile)
		env[AgentModelProfileEnvName(profile.ID)] = value
	}

	return profiles, env, nil
}

func (service *Settings) agentRuntimeAPIKey(providerKeyName string, profileID string) (string, error) {
	value, _, err := service.apiKeys.Get(providerKeyName)
	if err != nil {
		return "", err
	}
	value = strings.TrimSpace(value)
	if value != "" {
		return value, nil
	}

	legacyValue, _, err := service.apiKeys.Get(AgentModelProfileAPIKeyName(profileID))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(legacyValue), nil
}

// AgentModelProfileAPIKeyName returns the stable credential key for one profile.
func AgentModelProfileAPIKeyName(profileID string) string {
	return agentModelKeyPrefix + strings.TrimSpace(profileID) + agentModelKeySuffix
}

// AgentModelProfileEnvName returns the process environment variable used by opencode.
func AgentModelProfileEnvName(profileID string) string {
	name := strings.ToUpper(strings.TrimSpace(profileID))
	name = envNamePartPattern.ReplaceAllString(name, "_")
	name = strings.Trim(name, "_")
	if name == "" {
		name = "DEFAULT"
	}
	return "MEDIAGO_AGENT_MODEL_" + name + "_API_KEY"
}

func (service *Settings) listAgentModelProfileModels() ([]domainAgentModelProfile, error) {
	if service == nil || service.agentProfiles == nil {
		return nil, ErrAgentModelStoreMissing
	}
	return service.agentProfiles.ListAgentModelProfiles()
}

func (service *Settings) agentModelProfilesResponse(ctx context.Context, models []domainAgentModelProfile) (AgentModelProfilesResponse, error) {
	_ = ctx
	profiles := make([]AgentModelProfile, 0, len(models))
	defaultID := ""
	for _, model := range models {
		profile, err := service.agentModelProfileResponse(model)
		if err != nil {
			return AgentModelProfilesResponse{}, err
		}
		if profile.IsDefault && profile.Enabled && defaultID == "" {
			defaultID = profile.ID
		}
		profiles = append(profiles, profile)
	}
	return AgentModelProfilesResponse{
		Profiles:         profiles,
		DefaultProfileID: defaultID,
		Templates:        AgentModelProfileTemplates(),
	}, nil
}

func (service *Settings) agentModelProfileResponse(model domainAgentModelProfile) (AgentModelProfile, error) {
	keyName := strings.TrimSpace(model.APIKeyName)
	if keyName == "" {
		keyName = AgentModelProfileAPIKeyName(model.ID)
	}
	source := "none"
	masked := ""
	configured := false
	if service != nil && service.apiKeys != nil {
		value, valueSource, err := service.apiKeys.Get(keyName)
		if err != nil {
			return AgentModelProfile{}, err
		}
		value = strings.TrimSpace(value)
		configured = value != ""
		source = valueSource
		masked = maskAPIKey(value)
	}
	return AgentModelProfile{
		ID:               model.ID,
		Name:             model.Name,
		ProviderID:       model.ProviderID,
		ProviderLabel:    model.ProviderLabel,
		BaseURL:          model.BaseURL,
		Model:            model.Model,
		ModelDisplayName: model.ModelDisplayName,
		Enabled:          model.Enabled,
		IsDefault:        model.IsDefault,
		SupportsImages:   model.SupportsImages,
		SupportsTools:    model.SupportsTools,
		ContextWindow:    model.ContextWindow,
		MaxOutputTokens:  model.MaxOutputTokens,
		Temperature:      cloneFloat(model.Temperature),
		APIKey: AgentModelProfileAPIKeyStatus{
			Configured: configured,
			Source:     source,
			Masked:     masked,
		},
	}, nil
}

func (service *Settings) ensureAgentModelDefault() error {
	models, err := service.listAgentModelProfileModels()
	if err != nil {
		return err
	}
	enabled := make([]domainAgentModelProfile, 0, len(models))
	defaults := []domainAgentModelProfile{}
	for _, model := range models {
		if model.Enabled {
			enabled = append(enabled, model)
			if model.IsDefault {
				defaults = append(defaults, model)
			}
		}
	}
	if len(enabled) == 0 {
		return service.agentProfiles.ClearAgentModelProfileDefaults()
	}
	if len(defaults) == 1 {
		return nil
	}
	sort.SliceStable(enabled, func(i int, j int) bool {
		return strings.Compare(enabled[i].Name, enabled[j].Name) < 0
	})
	return service.agentProfiles.SetAgentModelProfileDefault(enabled[0].ID)
}

// AgentModelProfileTemplates returns built-in profile starters.
func AgentModelProfileTemplates() []AgentModelProfileTemplate {
	zero := 0.0
	templates := []AgentModelProfileTemplate{
		{
			ID:               "minimax",
			Name:             "MiniMax 国内",
			ProviderID:       "minimax-cn",
			ProviderLabel:    "MiniMax 国内",
			BaseURL:          "https://api.minimaxi.com/v1",
			Model:            "MiniMax-M3",
			ModelDisplayName: "MiniMax M3",
			SupportsTools:    true,
			Temperature:      &zero,
		},
		{
			ID:               "deepseek",
			Name:             "DeepSeek",
			ProviderID:       "deepseek",
			ProviderLabel:    "DeepSeek",
			BaseURL:          "https://api.deepseek.com/v1",
			Model:            "deepseek-chat",
			ModelDisplayName: "DeepSeek Chat",
			SupportsTools:    true,
			Temperature:      &zero,
		},
		{
			ID:               "openrouter",
			Name:             "OpenRouter",
			ProviderID:       "openrouter",
			ProviderLabel:    "OpenRouter",
			BaseURL:          "https://openrouter.ai/api/v1",
			Model:            "openai/gpt-4.1-mini",
			ModelDisplayName: "GPT-4.1 Mini",
			SupportsImages:   true,
			SupportsTools:    true,
			Temperature:      &zero,
		},
		{
			ID:               "dmx-gemini",
			Name:             "DMX Gemini",
			ProviderID:       agentModelProviderDMX,
			ProviderLabel:    "DMX",
			BaseURL:          "https://www.dmxapi.cn/v1",
			Model:            "gemini-3.1-pro-preview",
			ModelDisplayName: "Gemini 3.1 Pro Preview",
			Temperature:      &zero,
		},
	}
	result := make([]AgentModelProfileTemplate, len(templates))
	copy(result, templates)
	return result
}

func inputTemplate(id *string) AgentModelProfileTemplate {
	value := strings.TrimSpace(stringValue(id))
	return agentModelProfileTemplateByID(value)
}

func agentModelProfileTemplateByID(id string) AgentModelProfileTemplate {
	id = strings.TrimSpace(id)
	for _, template := range AgentModelProfileTemplates() {
		if template.ID == id {
			return template
		}
	}
	return AgentModelProfileTemplate{}
}

type officialAgentModelProfileSpec struct {
	TemplateID        string
	CredentialKeyName string
}

func officialAgentModelProfileSpecs() []officialAgentModelProfileSpec {
	return []officialAgentModelProfileSpec{
		{TemplateID: "openrouter", CredentialKeyName: "openrouter"},
		{TemplateID: "dmx-gemini", CredentialKeyName: agentModelProviderDMX},
		{TemplateID: "minimax", CredentialKeyName: "minimax"},
		{TemplateID: "deepseek", CredentialKeyName: agentModelProviderDeepSeek},
	}
}

func supportsOfficialAgentModel(providerID string) bool {
	providerID = strings.TrimSpace(providerID)
	for _, spec := range officialAgentModelProfileSpecs() {
		if spec.CredentialKeyName == providerID {
			return true
		}
	}
	return false
}

func profileModelFromTemplate(template AgentModelProfileTemplate) domainAgentModelProfile {
	return domainAgentModelProfile{
		ID:               profileIDFromProviderID(template.ProviderID),
		Name:             strings.TrimSpace(template.Name),
		ProviderID:       strings.TrimSpace(template.ProviderID),
		ProviderLabel:    strings.TrimSpace(template.ProviderLabel),
		BaseURL:          strings.TrimSpace(template.BaseURL),
		Model:            strings.TrimSpace(template.Model),
		ModelDisplayName: strings.TrimSpace(template.ModelDisplayName),
		Enabled:          true,
		SupportsImages:   template.SupportsImages,
		SupportsTools:    template.SupportsTools,
		ContextWindow:    template.ContextWindow,
		MaxOutputTokens:  template.MaxOutputTokens,
		Temperature:      cloneFloat(template.Temperature),
	}
}

func applyProfileMutation(model *domainAgentModelProfile, input AgentModelProfileMutation, creating bool) {
	if input.Name != nil {
		model.Name = strings.TrimSpace(*input.Name)
	}
	if input.ProviderID != nil {
		model.ProviderID = strings.TrimSpace(*input.ProviderID)
		if creating {
			model.ID = profileIDFromProviderID(model.ProviderID)
		}
	}
	if input.ProviderLabel != nil {
		model.ProviderLabel = strings.TrimSpace(*input.ProviderLabel)
	}
	if input.BaseURL != nil {
		model.BaseURL = strings.TrimSpace(*input.BaseURL)
	}
	if input.Model != nil {
		model.Model = strings.TrimSpace(*input.Model)
	}
	if input.ModelDisplayName != nil {
		model.ModelDisplayName = strings.TrimSpace(*input.ModelDisplayName)
	}
	if input.Enabled != nil {
		model.Enabled = *input.Enabled
	}
	if input.IsDefault != nil {
		model.IsDefault = *input.IsDefault
	}
	if input.SupportsImages != nil {
		model.SupportsImages = *input.SupportsImages
	}
	if input.SupportsTools != nil {
		model.SupportsTools = *input.SupportsTools
	}
	if input.ContextWindow != nil {
		model.ContextWindow = *input.ContextWindow
	}
	if input.MaxOutputTokens != nil {
		model.MaxOutputTokens = *input.MaxOutputTokens
	}
	if input.Temperature != nil {
		value := *input.Temperature
		model.Temperature = &value
	}
}

func validateAgentModelProfile(model domainAgentModelProfile) error {
	if strings.TrimSpace(model.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrAgentModelInvalid)
	}
	if !providerIDPattern.MatchString(strings.TrimSpace(model.ProviderID)) {
		return fmt.Errorf("%w: providerId is invalid", ErrAgentModelInvalid)
	}
	if strings.TrimSpace(model.ProviderLabel) == "" {
		return fmt.Errorf("%w: providerLabel is required", ErrAgentModelInvalid)
	}
	if !validHTTPURL(model.BaseURL) {
		return fmt.Errorf("%w: baseURL is invalid", ErrAgentModelInvalid)
	}
	if strings.TrimSpace(model.Model) == "" {
		return fmt.Errorf("%w: model is required", ErrAgentModelInvalid)
	}
	if strings.TrimSpace(model.ModelDisplayName) == "" {
		return fmt.Errorf("%w: modelDisplayName is required", ErrAgentModelInvalid)
	}
	if model.ContextWindow < 0 || model.MaxOutputTokens < 0 {
		return fmt.Errorf("%w: token limits must be non-negative", ErrAgentModelInvalid)
	}
	if model.Temperature != nil && (*model.Temperature < 0 || *model.Temperature > 2) {
		return fmt.Errorf("%w: temperature must be between 0 and 2", ErrAgentModelInvalid)
	}
	return nil
}

func validHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func profileIDFromProviderID(providerID string) string {
	value := strings.ToLower(strings.TrimSpace(providerID))
	value = strings.ReplaceAll(value, ".", "-")
	value = profileIDPattern.ReplaceAllString(value, "-")
	return strings.Trim(value, "-_")
}

func isProfileNotFound(err error) bool {
	return errors.Is(err, ErrAgentModelNotFound) || errors.Is(err, gorm.ErrRecordNotFound)
}

func cloneFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type openCodeConfigFile struct {
	Schema   string                            `json:"$schema"`
	Model    string                            `json:"model,omitempty"`
	Agent    map[string]openCodeAgentConfig    `json:"agent,omitempty"`
	Provider map[string]openCodeProviderConfig `json:"provider,omitempty"`
}

type openCodeAgentConfig struct {
	Temperature *float64 `json:"temperature,omitempty"`
}

type openCodeProviderConfig struct {
	NPM     string                         `json:"npm"`
	Name    string                         `json:"name"`
	Options openCodeProviderOptions        `json:"options"`
	Models  map[string]openCodeModelConfig `json:"models"`
}

type openCodeProviderOptions struct {
	BaseURL string `json:"baseURL"`
	APIKey  string `json:"apiKey"`
}

type openCodeModelConfig struct {
	Name       string                   `json:"name"`
	Attachment bool                     `json:"attachment,omitempty"`
	ToolCall   bool                     `json:"tool_call,omitempty"`
	Limit      *openCodeModelLimit      `json:"limit,omitempty"`
	Modalities *openCodeModelModalities `json:"modalities,omitempty"`
}

type openCodeModelLimit struct {
	Context int `json:"context"`
	Output  int `json:"output"`
}

type openCodeModelModalities struct {
	Input  []string `json:"input,omitempty"`
	Output []string `json:"output,omitempty"`
}

func renderOpenCodeConfig(profiles []domainAgentModelProfile) openCodeConfigFile {
	config := openCodeConfigFile{
		Schema:   opencodeConfigSchema,
		Provider: map[string]openCodeProviderConfig{},
	}
	defaultProfile := domainAgentModelProfile{}
	for _, profile := range profiles {
		if profile.Enabled && profile.IsDefault && defaultProfile.ID == "" {
			defaultProfile = profile
		}
		if !profile.Enabled {
			continue
		}
		model := openCodeModelConfig{
			Name:       firstNonEmpty(strings.TrimSpace(profile.ModelDisplayName), strings.TrimSpace(profile.Model)),
			ToolCall:   profile.SupportsTools,
			Attachment: profile.SupportsImages,
			Modalities: &openCodeModelModalities{
				Input:  openCodeInputModalities(profile.SupportsImages),
				Output: []string{"text"},
			},
		}
		if profile.ContextWindow > 0 && profile.MaxOutputTokens > 0 {
			model.Limit = &openCodeModelLimit{Context: profile.ContextWindow, Output: profile.MaxOutputTokens}
		}
		config.Provider[profile.ProviderID] = openCodeProviderConfig{
			NPM:  "@ai-sdk/openai-compatible",
			Name: firstNonEmpty(strings.TrimSpace(profile.ProviderLabel), strings.TrimSpace(profile.ProviderID)),
			Options: openCodeProviderOptions{
				BaseURL: strings.TrimRight(strings.TrimSpace(profile.BaseURL), "/"),
				APIKey:  "{env:" + AgentModelProfileEnvName(profile.ID) + "}",
			},
			Models: map[string]openCodeModelConfig{
				profile.Model: model,
			},
		}
	}
	if defaultProfile.ID != "" {
		config.Model = defaultProfile.ProviderID + "/" + defaultProfile.Model
		if defaultProfile.Temperature != nil {
			config.Agent = map[string]openCodeAgentConfig{
				"build": {Temperature: cloneFloat(defaultProfile.Temperature)},
				"plan":  {Temperature: cloneFloat(defaultProfile.Temperature)},
			}
		}
	}
	return config
}

func writeOpenCodeConfig(path string, config openCodeConfigFile) error {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(config); err != nil {
		return fmt.Errorf("encoding opencode config: %w", err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
		return fmt.Errorf("writing opencode config: %w", err)
	}
	return nil
}

func openCodeInputModalities(supportsImages bool) []string {
	if supportsImages {
		return []string{"text", "image"}
	}
	return []string{"text"}
}

func defaultProfileID(profiles []domainAgentModelProfile) string {
	for _, profile := range profiles {
		if profile.Enabled && profile.IsDefault {
			return profile.ID
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
