package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/jimeng"
)

// Settings errors returned by the settings service.
var (
	ErrAPIKeyProviderNotFound = errors.New("api key provider not found")
	ErrAPIKeyRequired         = errors.New("apiKey is required")
	ErrProviderLoginRequired  = errors.New("provider login challenge is required")
	ErrAgentModelStoreMissing = errors.New("agent model profile store is unavailable")
	ErrAgentModelNotFound     = errors.New("agent model profile not found")
	ErrAgentModelInvalid      = errors.New("agent model profile is invalid")
	ErrAgentModelConflict     = errors.New("agent model provider id already exists")
)

const (
	jimengLoginStartTimeout = 60 * time.Second
	jimengLoginCheckTimeout = 45 * time.Second
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
	CredentialKind  string `json:"credentialKind,omitempty"`
	keyName         string
}

// APIKeyList is the API key provider listing.
type APIKeyList struct {
	Providers []APIKeyProvider `json:"providers"`
}

// ProviderLoginChallenge describes a provider OAuth device login state.
type ProviderLoginChallenge struct {
	Status          string `json:"status"`
	VerificationURI string `json:"verificationUri,omitempty"`
	UserCode        string `json:"userCode,omitempty"`
	DeviceCode      string `json:"deviceCode,omitempty"`
	Message         string `json:"message,omitempty"`
}

// APIKeyLoginResult returns provider state and the current login challenge.
type APIKeyLoginResult struct {
	Providers []APIKeyProvider       `json:"providers"`
	Login     ProviderLoginChallenge `json:"login"`
}

// Settings provides settings workflows.
type Settings struct {
	apiKeys       APIKeyStore
	agentProfiles AgentModelProfileStore
	jimengBinPath string
	jimengBinDir  string
}

// NewSettings creates a settings service.
func NewSettings(apiKeys APIKeyStore) *Settings {
	return NewSettingsWithAgentModelProfiles(apiKeys, nil)
}

// NewSettingsWithAgentModelProfiles creates a settings service with agent model profile storage.
func NewSettingsWithAgentModelProfiles(apiKeys APIKeyStore, agentProfiles AgentModelProfileStore) *Settings {
	return &Settings{apiKeys: apiKeys, agentProfiles: agentProfiles}
}

// SetJimengCLIPaths configures the local Jimeng CLI lookup paths.
func (service *Settings) SetJimengCLIPaths(binPath string, binDir string) {
	service.jimengBinPath = strings.TrimSpace(binPath)
	service.jimengBinDir = strings.TrimSpace(binDir)
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
		if providers[index].CredentialKind != "oauth" {
			providers[index].Masked = maskAPIKey(value)
		}
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

// BeginJimengLogin starts the local Jimeng OAuth device login flow.
func (service *Settings) BeginJimengLogin(ctx context.Context, force bool) (APIKeyLoginResult, error) {
	if _, ok := findAPIKeyProvider(generation.ProviderJimeng); !ok {
		return APIKeyLoginResult{}, ErrAPIKeyProviderNotFound
	}
	command := "login"
	if force {
		command = "relogin"
	}
	output, err := service.runJimengCommand(ctx, jimengLoginStartTimeout, command, "--headless")
	if err != nil {
		return APIKeyLoginResult{}, err
	}

	login := parseJimengLoginChallenge(output)
	if login.Status == "pending" {
		if force {
			if err := service.apiKeys.Clear(generation.ProviderJimeng); err != nil {
				return APIKeyLoginResult{}, err
			}
		}
		return service.apiKeyLoginResult(ctx, login)
	}
	if err := service.apiKeys.Set(generation.ProviderJimeng, "oauth:"+time.Now().UTC().Format(time.RFC3339)); err != nil {
		return APIKeyLoginResult{}, err
	}
	if login.Status == "" {
		login.Status = "completed"
	}
	if login.Message == "" {
		login.Message = "即梦本地登录态已可用"
	}
	return service.apiKeyLoginResult(ctx, login)
}

// CompleteJimengLogin checks a prior Jimeng OAuth device login and stores a local session marker.
func (service *Settings) CompleteJimengLogin(ctx context.Context, deviceCode string) (APIKeyLoginResult, error) {
	if _, ok := findAPIKeyProvider(generation.ProviderJimeng); !ok {
		return APIKeyLoginResult{}, ErrAPIKeyProviderNotFound
	}
	deviceCode = strings.TrimSpace(deviceCode)
	if deviceCode == "" {
		return APIKeyLoginResult{}, ErrProviderLoginRequired
	}
	output, err := service.runJimengCommand(
		ctx,
		jimengLoginCheckTimeout,
		"login",
		"checklogin",
		"--device_code="+deviceCode,
		"--poll=30",
	)
	if err != nil {
		return APIKeyLoginResult{}, err
	}
	if err := service.apiKeys.Set(generation.ProviderJimeng, "oauth:"+time.Now().UTC().Format(time.RFC3339)); err != nil {
		return APIKeyLoginResult{}, err
	}
	login := ProviderLoginChallenge{
		Status:  "completed",
		Message: strings.TrimSpace(string(output)),
	}
	if login.Message == "" {
		login.Message = "即梦本地登录态已可用"
	}
	return service.apiKeyLoginResult(ctx, login)
}

func (service *Settings) runJimengCommand(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	binPath, err := jimeng.ResolveBinaryPath(service.jimengBinPath, service.jimengBinDir)
	if err != nil {
		return nil, err
	}

	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandCtx, binPath, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return output, fmt.Errorf("jimeng %s failed: %w", strings.Join(args, " "), err)
		}
		return output, fmt.Errorf("jimeng %s failed: %w: %s", strings.Join(args, " "), err, message)
	}
	return output, nil
}

func (service *Settings) apiKeyLoginResult(ctx context.Context, login ProviderLoginChallenge) (APIKeyLoginResult, error) {
	list, err := service.ListAPIKeys(ctx)
	if err != nil {
		return APIKeyLoginResult{}, err
	}
	return APIKeyLoginResult{Providers: list.Providers, Login: login}, nil
}

func parseJimengLoginChallenge(output []byte) ProviderLoginChallenge {
	text := strings.TrimSpace(string(output))
	login := ProviderLoginChallenge{Message: text}
	if text == "" {
		return ProviderLoginChallenge{Status: "completed"}
	}

	var payload map[string]any
	if err := json.Unmarshal(output, &payload); err == nil {
		login.VerificationURI = firstString(payload, "verification_uri", "verification_url", "verificationUri")
		login.UserCode = firstString(payload, "user_code", "userCode")
		login.DeviceCode = firstString(payload, "device_code", "deviceCode")
		login.Message = firstString(payload, "message", "msg")
	}
	if login.VerificationURI == "" {
		login.VerificationURI = loginOutputValue(text, "verification_uri", "verification_url", "verificationUri")
	}
	if login.UserCode == "" {
		login.UserCode = loginOutputValue(text, "user_code", "userCode")
	}
	if login.DeviceCode == "" {
		login.DeviceCode = loginOutputValue(text, "device_code", "deviceCode")
	}
	if login.VerificationURI != "" || login.UserCode != "" || login.DeviceCode != "" {
		login.Status = "pending"
		return login
	}
	login.Status = "completed"
	return login
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := values[key]
		if !ok || value == nil {
			continue
		}
		text, ok := value.(string)
		if ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func loginOutputValue(output string, keys ...string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		for _, key := range keys {
			for _, separator := range []string{":", "="} {
				prefix := key + separator
				if strings.HasPrefix(strings.ToLower(line), strings.ToLower(prefix)) {
					return strings.TrimSpace(line[len(prefix):])
				}
			}
		}
	}
	return ""
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
			CredentialKind:  spec.CredentialKind,
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
