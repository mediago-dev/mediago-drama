package settings

import (
	"context"
	"errors"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

// Settings errors returned by the settings service.
var (
	ErrAPIKeyProviderNotFound = errors.New("api key provider not found")
	ErrAPIKeyRequired         = errors.New("apiKey is required")
	ErrAgentModelStoreMissing = errors.New("agent model profile store is unavailable")
	ErrAgentModelNotFound     = errors.New("agent model profile not found")
	ErrAgentModelInvalid      = errors.New("agent model profile is invalid")
	ErrAgentModelConflict     = errors.New("agent model provider id already exists")
)

// APIKeyStore persists API keys for configured providers.
type APIKeyStore interface {
	Get(keyName string) (string, string, error)
	Set(keyName string, value string) error
	Clear(keyName string) error
}

// AgentModelProfileStore persists global ACP model profiles.
type AgentModelProfileStore interface {
	ListAgentModelProfiles() ([]domainAgentModelProfile, error)
	GetAgentModelProfile(id string) (domainAgentModelProfile, error)
	UpsertAgentModelProfile(model domainAgentModelProfile) error
	DeleteAgentModelProfile(id string) (bool, error)
	ClearAgentModelProfileDefaults() error
	SetAgentModelProfileDefault(id string) error
}

// APIKeyProvider describes one configurable API key provider.
type APIKeyProvider struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Description     string `json:"description"`
	Configured      bool   `json:"configured"`
	Source          string `json:"source"`
	Masked          string `json:"masked,omitempty"`
	CredentialLabel string `json:"credentialLabel,omitempty"`
	Placeholder     string `json:"placeholder,omitempty"`
	Help            string `json:"help,omitempty"`
	keyName         string
}

// APIKeyList is the API key provider listing.
type APIKeyList struct {
	Providers []APIKeyProvider `json:"providers"`
}

// Settings provides settings workflows.
type Settings struct {
	apiKeys       APIKeyStore
	agentProfiles AgentModelProfileStore
}

// NewSettings creates a settings service.
func NewSettings(apiKeys APIKeyStore) *Settings {
	return NewSettingsWithAgentModelProfiles(apiKeys, nil)
}

// NewSettingsWithAgentModelProfiles creates a settings service with agent model profile storage.
func NewSettingsWithAgentModelProfiles(apiKeys APIKeyStore, agentProfiles AgentModelProfileStore) *Settings {
	return &Settings{apiKeys: apiKeys, agentProfiles: agentProfiles}
}

// ListAPIKeys lists all providers with their configured state.
func (service *Settings) ListAPIKeys(ctx context.Context) (APIKeyList, error) {
	_ = ctx
	providers := apiKeyProviders()
	for index := range providers {
		value, source, err := service.apiKeys.Get(providers[index].keyName)
		if err != nil {
			return APIKeyList{}, err
		}
		providers[index].Configured = value != ""
		providers[index].Source = source
		providers[index].Masked = maskAPIKey(value)
	}

	return APIKeyList{Providers: providers}, nil
}

// SetAPIKey stores a provider API key and returns the updated provider list.
func (service *Settings) SetAPIKey(ctx context.Context, providerID string, value string) (APIKeyList, error) {
	provider, ok := findAPIKeyProvider(providerID)
	if !ok {
		return APIKeyList{}, ErrAPIKeyProviderNotFound
	}
	if strings.TrimSpace(value) == "" {
		return APIKeyList{}, ErrAPIKeyRequired
	}
	if err := service.apiKeys.Set(provider.keyName, value); err != nil {
		return APIKeyList{}, err
	}
	return service.ListAPIKeys(ctx)
}

// ClearAPIKey removes a provider API key and returns the updated provider list.
func (service *Settings) ClearAPIKey(ctx context.Context, providerID string) (APIKeyList, error) {
	provider, ok := findAPIKeyProvider(providerID)
	if !ok {
		return APIKeyList{}, ErrAPIKeyProviderNotFound
	}
	if err := service.apiKeys.Clear(provider.keyName); err != nil {
		return APIKeyList{}, err
	}
	return service.ListAPIKeys(ctx)
}

// GetAPIKey returns an API key by provider key name.
func (service *Settings) GetAPIKey(ctx context.Context, keyName string) (string, string, error) {
	_ = ctx
	return service.apiKeys.Get(keyName)
}

// ProviderLabel returns a display label for a provider key name.
func (service *Settings) ProviderLabel(keyName string) string {
	provider, ok := findAPIKeyProvider(keyName)
	if ok && provider.Label != "" {
		return provider.Label
	}
	return keyName
}

func apiKeyProviders() []APIKeyProvider {
	specs := generation.CredentialSpecs()
	providers := make([]APIKeyProvider, 0, len(specs))
	for _, spec := range specs {
		providers = append(providers, APIKeyProvider{
			ID:              spec.ID,
			Label:           spec.Label,
			Description:     spec.Description,
			CredentialLabel: spec.CredentialLabel,
			Placeholder:     spec.Placeholder,
			Help:            spec.Help,
			keyName:         spec.ID,
		})
	}

	return providers
}

func findAPIKeyProvider(id string) (APIKeyProvider, bool) {
	for _, provider := range apiKeyProviders() {
		if provider.ID == id {
			return provider, true
		}
	}

	return APIKeyProvider{}, false
}

func maskAPIKey(value string) string {
	if value == "" {
		return ""
	}
	if len(value) <= 8 {
		return "••••"
	}

	return value[:4] + strings.Repeat("•", 8) + value[len(value)-4:]
}
