package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const (
	codexRelaySettingsKey       = "codex.relay.settings.v1"
	codexRelayAPIKeyPrefix      = "codex-relay:"
	codexRelayAPIKeySuffix      = ":api-key"
	codexRelayProviderID        = "mediago-codex-relay"
	codexRelayLocalBearerToken  = "mediago-codex-relay"
	codexRelayDefaultHTTPClient = 60 * time.Second
	codexRelayCheckHTTPClient   = 10 * time.Second
	codexRelayCheckBodyLimit    = 1024 * 1024
)

// CodexRelayProtocol identifies the upstream protocol used by one relay profile.
type CodexRelayProtocol string

const (
	// CodexRelayProtocolResponses sends Codex Responses API payloads to a compatible upstream.
	CodexRelayProtocolResponses CodexRelayProtocol = "responses"
	// CodexRelayProtocolChatCompletions is reserved for a protocol converter phase.
	CodexRelayProtocolChatCompletions CodexRelayProtocol = "chatCompletions"
)

// CodexRelayAPIKeyStatus describes the redacted credential state for one relay profile.
type CodexRelayAPIKeyStatus struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"`
	Masked     string `json:"masked,omitempty"`
}

// CodexRelayProfile describes one Codex relay target.
type CodexRelayProfile struct {
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	BaseURL  string                 `json:"baseURL"`
	Model    string                 `json:"model"`
	Protocol CodexRelayProtocol     `json:"protocol"`
	Enabled  bool                   `json:"enabled"`
	APIKey   CodexRelayAPIKeyStatus `json:"apiKey"`
}

// CodexRelaySettingsResponse is returned by the Codex relay settings API.
type CodexRelaySettingsResponse struct {
	Enabled         bool                `json:"enabled"`
	ActiveProfileID string              `json:"activeProfileId,omitempty"`
	Profiles        []CodexRelayProfile `json:"profiles"`
}

// CodexRelayCheckRequest chooses which relay profile to probe.
type CodexRelayCheckRequest struct {
	ProfileID string `json:"profileId"`
}

// CodexRelayCheckResponse describes an upstream reachability check for a relay profile.
type CodexRelayCheckResponse struct {
	OK         bool     `json:"ok"`
	ProfileID  string   `json:"profileId"`
	BaseURL    string   `json:"baseURL"`
	StatusCode int      `json:"statusCode"`
	Models     []string `json:"models"`
}

type codexRelayModelsPayload struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// CodexRelayProfileMutation stores non-secret profile fields.
type CodexRelayProfileMutation struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	BaseURL  string             `json:"baseURL"`
	Model    string             `json:"model"`
	Protocol CodexRelayProtocol `json:"protocol"`
	Enabled  bool               `json:"enabled"`
}

// CodexRelaySettingsMutation replaces the non-secret relay settings.
type CodexRelaySettingsMutation struct {
	Enabled         bool                        `json:"enabled"`
	ActiveProfileID string                      `json:"activeProfileId"`
	Profiles        []CodexRelayProfileMutation `json:"profiles"`
}

// CodexRelayRuntimeConfig describes the process config generated for Codex ACP.
type CodexRelayRuntimeConfig struct {
	ConfigDir  string
	CodexHome  string
	Env        map[string]string
	Configured bool
}

type codexRelayStoredSettings struct {
	Enabled         bool                        `json:"enabled"`
	ActiveProfileID string                      `json:"activeProfileId,omitempty"`
	Profiles        []CodexRelayProfileMutation `json:"profiles,omitempty"`
}

// GetCodexRelaySettings returns the saved Codex relay settings with redacted key status.
func (service *Settings) GetCodexRelaySettings(ctx context.Context) (CodexRelaySettingsResponse, error) {
	_ = ctx
	stored, err := service.loadCodexRelayStoredSettings()
	if err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	return service.codexRelaySettingsResponse(stored)
}

// SaveCodexRelaySettings stores non-secret Codex relay settings.
func (service *Settings) SaveCodexRelaySettings(ctx context.Context, input CodexRelaySettingsMutation) (CodexRelaySettingsResponse, error) {
	_ = ctx
	if service.appSettings == nil {
		return CodexRelaySettingsResponse{}, ErrAppSettingStoreMissing
	}
	stored, err := normalizeCodexRelaySettings(input)
	if err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	previous, err := service.loadCodexRelayStoredSettings()
	if err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	if len(stored.Profiles) == 0 {
		if err := service.clearRemovedCodexRelayAPIKeys(previous, stored); err != nil {
			return CodexRelaySettingsResponse{}, err
		}
		if err := service.appSettings.ClearAppSetting(codexRelaySettingsKey); err != nil {
			return CodexRelaySettingsResponse{}, err
		}
		return service.codexRelaySettingsResponse(codexRelayStoredSettings{})
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return CodexRelaySettingsResponse{}, fmt.Errorf("encoding codex relay settings: %w", err)
	}
	if err := service.appSettings.SetAppSetting(codexRelaySettingsKey, string(raw)); err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	if err := service.clearRemovedCodexRelayAPIKeys(previous, stored); err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	return service.codexRelaySettingsResponse(stored)
}

// SetCodexRelayProfileAPIKey stores a Codex relay profile API key.
func (service *Settings) SetCodexRelayProfileAPIKey(ctx context.Context, profileID string, apiKey string) (CodexRelaySettingsResponse, error) {
	if service.apiKeys == nil {
		return CodexRelaySettingsResponse{}, ErrAPIKeyProviderNotFound
	}
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return CodexRelaySettingsResponse{}, fmt.Errorf("%w: profile id is required", ErrCodexRelayInvalid)
	}
	if strings.TrimSpace(apiKey) == "" {
		return CodexRelaySettingsResponse{}, ErrAPIKeyRequired
	}
	stored, err := service.loadCodexRelayStoredSettings()
	if err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	if !codexRelayStoredProfileExists(stored, profileID) {
		return CodexRelaySettingsResponse{}, ErrCodexRelayNotConfigured
	}
	if err := service.apiKeys.Set(CodexRelayAPIKeyName(profileID), apiKey); err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	return service.GetCodexRelaySettings(ctx)
}

// ClearCodexRelayProfileAPIKey removes a Codex relay profile API key.
func (service *Settings) ClearCodexRelayProfileAPIKey(ctx context.Context, profileID string) (CodexRelaySettingsResponse, error) {
	if service.apiKeys == nil {
		return CodexRelaySettingsResponse{}, ErrAPIKeyProviderNotFound
	}
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return CodexRelaySettingsResponse{}, fmt.Errorf("%w: profile id is required", ErrCodexRelayInvalid)
	}
	if err := service.apiKeys.Clear(CodexRelayAPIKeyName(profileID)); err != nil {
		return CodexRelaySettingsResponse{}, err
	}
	return service.GetCodexRelaySettings(ctx)
}

// CheckCodexRelay verifies a Codex relay profile can authenticate against its upstream.
func (service *Settings) CheckCodexRelay(ctx context.Context, input CodexRelayCheckRequest) (CodexRelayCheckResponse, error) {
	active, apiKey, err := service.codexRelayProfileWithKey(input.ProfileID, true)
	if err != nil {
		return CodexRelayCheckResponse{}, err
	}
	if active.Protocol != CodexRelayProtocolResponses {
		return CodexRelayCheckResponse{}, fmt.Errorf("%w: chat completions relay is not implemented yet", ErrCodexRelayInvalid)
	}
	upstreamURL, err := codexRelayUpstreamURL(active.BaseURL, "/v1/models")
	if err != nil {
		return CodexRelayCheckResponse{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		return CodexRelayCheckResponse{}, fmt.Errorf("creating codex relay check request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: codexRelayCheckHTTPClient}
	response, err := client.Do(request)
	result := CodexRelayCheckResponse{
		ProfileID: active.ID,
		BaseURL:   active.BaseURL,
		Models:    []string{},
	}
	if err != nil {
		return result, fmt.Errorf("%w：连接上游失败，请检查 Base URL", ErrCodexRelayCheckFailed)
	}
	defer response.Body.Close()

	result.StatusCode = response.StatusCode
	body := readLimitedCodexRelayCheckBody(response.Body)
	if codexRelayCheckStatusOK(response.StatusCode) && !codexRelayBodyLooksInvalidAPIKey(body) {
		result.OK = true
		result.Models = codexRelayModelIDs(body)
		return result, nil
	}
	if codexRelayCheckStatusAuthFailed(response.StatusCode) || codexRelayBodyLooksInvalidAPIKey(body) {
		return result, fmt.Errorf("%w：上游返回 %d，请检查 API Key 和 Base URL", ErrCodexRelayCheckFailed, response.StatusCode)
	}
	return result, fmt.Errorf("%w：上游返回 %d，请检查 Base URL 是否正确", ErrCodexRelayCheckFailed, response.StatusCode)
}

// PrepareCodexRelayRuntimeConfig writes a Codex home configured for the active relay profile.
func (service *Settings) PrepareCodexRelayRuntimeConfig(ctx context.Context, workspaceDir string, relayBaseURL string) (CodexRelayRuntimeConfig, error) {
	_ = ctx
	active, _, err := service.activeCodexRelayProfile()
	if err != nil {
		if err == ErrCodexRelayNotConfigured {
			return CodexRelayRuntimeConfig{}, nil
		}
		return CodexRelayRuntimeConfig{}, err
	}
	relayBaseURL = strings.TrimRight(strings.TrimSpace(relayBaseURL), "/")
	if relayBaseURL == "" {
		return CodexRelayRuntimeConfig{}, fmt.Errorf("%w: local relay url is empty", ErrCodexRelayInvalid)
	}

	codexHome := filepath.Join(shared.WorkspacePathsFor(workspaceDir).GlobalMetadataDir(), "runtime", "agents", "codex", "home")
	if err := os.MkdirAll(codexHome, 0o700); err != nil {
		return CodexRelayRuntimeConfig{}, fmt.Errorf("creating codex relay home: %w", err)
	}
	configText := renderCodexRelayConfig(active, relayBaseURL)
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(configText), 0o600); err != nil {
		return CodexRelayRuntimeConfig{}, fmt.Errorf("writing codex relay config: %w", err)
	}
	authText := `{"OPENAI_API_KEY":"` + codexRelayLocalBearerToken + `"}` + "\n"
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(authText), 0o600); err != nil {
		return CodexRelayRuntimeConfig{}, fmt.Errorf("writing codex relay auth: %w", err)
	}
	return CodexRelayRuntimeConfig{
		ConfigDir:  codexHome,
		CodexHome:  codexHome,
		Configured: true,
		Env: map[string]string{
			"CODEX_HOME":     codexHome,
			"OPENAI_API_KEY": codexRelayLocalBearerToken,
		},
	}, nil
}

// OpenCodexRelayRequest opens an upstream request for the active Codex relay profile.
func (service *Settings) OpenCodexRelayRequest(ctx context.Context, method string, relayPath string, body []byte, headers http.Header) (*http.Response, error) {
	if !validCodexRelayLocalAuthorization(headers) {
		return nil, ErrCodexRelayUnauthorized
	}
	active, apiKey, err := service.activeCodexRelayProfile()
	if err != nil {
		return nil, err
	}
	if active.Protocol != CodexRelayProtocolResponses {
		return nil, fmt.Errorf("%w: chat completions relay is not implemented yet", ErrCodexRelayInvalid)
	}
	upstreamURL, err := codexRelayUpstreamURL(active.BaseURL, relayPath)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating codex relay request: %w", err)
	}
	copyCodexRelayRequestHeaders(request.Header, headers)
	request.Header.Set("Authorization", "Bearer "+apiKey)
	if request.Header.Get("Content-Type") == "" && len(body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: codexRelayDefaultHTTPClient}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("requesting codex relay upstream: %w", err)
	}
	return response, nil
}

// CodexRelayAPIKeyName returns the settings key used for one relay profile secret.
func CodexRelayAPIKeyName(profileID string) string {
	return codexRelayAPIKeyPrefix + strings.TrimSpace(profileID) + codexRelayAPIKeySuffix
}

func (service *Settings) activeCodexRelayProfile() (CodexRelayProfileMutation, string, error) {
	return service.codexRelayProfileWithKey("", false)
}

func (service *Settings) codexRelayProfileWithKey(profileID string, allowGlobalDisabled bool) (CodexRelayProfileMutation, string, error) {
	stored, err := service.loadCodexRelayStoredSettings()
	if err != nil {
		return CodexRelayProfileMutation{}, "", err
	}
	targetProfileID := strings.TrimSpace(profileID)
	checkingActiveProfile := targetProfileID == ""
	if checkingActiveProfile {
		if (!allowGlobalDisabled && !stored.Enabled) || stored.ActiveProfileID == "" {
			return CodexRelayProfileMutation{}, "", ErrCodexRelayNotConfigured
		}
		targetProfileID = stored.ActiveProfileID
	}
	for _, profile := range stored.Profiles {
		if profile.ID != targetProfileID {
			continue
		}
		if checkingActiveProfile && !profile.Enabled {
			return CodexRelayProfileMutation{}, "", ErrCodexRelayNotConfigured
		}
		apiKey, _, err := service.apiKeys.Get(CodexRelayAPIKeyName(profile.ID))
		if err != nil {
			return CodexRelayProfileMutation{}, "", err
		}
		if strings.TrimSpace(apiKey) == "" {
			return CodexRelayProfileMutation{}, "", ErrCodexRelayNotConfigured
		}
		return profile, strings.TrimSpace(apiKey), nil
	}
	return CodexRelayProfileMutation{}, "", ErrCodexRelayNotConfigured
}

func (service *Settings) loadCodexRelayStoredSettings() (codexRelayStoredSettings, error) {
	if service.appSettings == nil {
		return codexRelayStoredSettings{}, ErrAppSettingStoreMissing
	}
	value, ok, err := service.appSettings.GetAppSetting(codexRelaySettingsKey)
	if err != nil {
		return codexRelayStoredSettings{}, err
	}
	if !ok || strings.TrimSpace(value) == "" {
		return codexRelayStoredSettings{}, nil
	}
	var stored codexRelayStoredSettings
	if err := json.Unmarshal([]byte(value), &stored); err != nil {
		return codexRelayStoredSettings{}, fmt.Errorf("%w: parsing saved settings: %v", ErrCodexRelayInvalid, err)
	}
	return normalizeCodexRelaySettings(CodexRelaySettingsMutation(stored))
}

func (service *Settings) codexRelaySettingsResponse(stored codexRelayStoredSettings) (CodexRelaySettingsResponse, error) {
	profiles := make([]CodexRelayProfile, 0, len(stored.Profiles))
	for _, profile := range stored.Profiles {
		apiKey, source, err := service.apiKeys.Get(CodexRelayAPIKeyName(profile.ID))
		if err != nil {
			return CodexRelaySettingsResponse{}, err
		}
		profiles = append(profiles, CodexRelayProfile{
			ID:       profile.ID,
			Name:     profile.Name,
			BaseURL:  profile.BaseURL,
			Model:    profile.Model,
			Protocol: profile.Protocol,
			Enabled:  profile.Enabled,
			APIKey: CodexRelayAPIKeyStatus{
				Configured: strings.TrimSpace(apiKey) != "",
				Source:     source,
				Masked:     maskAPIKey(apiKey),
			},
		})
	}
	return CodexRelaySettingsResponse{
		Enabled:         stored.Enabled,
		ActiveProfileID: stored.ActiveProfileID,
		Profiles:        profiles,
	}, nil
}

func (service *Settings) clearRemovedCodexRelayAPIKeys(previous codexRelayStoredSettings, next codexRelayStoredSettings) error {
	if len(previous.Profiles) == 0 {
		return nil
	}
	if service.apiKeys == nil {
		return ErrAPIKeyProviderNotFound
	}
	activeIDs := make(map[string]bool, len(next.Profiles))
	for _, profile := range next.Profiles {
		activeIDs[profile.ID] = true
	}
	for _, profile := range previous.Profiles {
		if activeIDs[profile.ID] {
			continue
		}
		if err := service.apiKeys.Clear(CodexRelayAPIKeyName(profile.ID)); err != nil {
			return err
		}
	}
	return nil
}

func normalizeCodexRelaySettings(input CodexRelaySettingsMutation) (codexRelayStoredSettings, error) {
	stored := codexRelayStoredSettings{
		Enabled:         input.Enabled,
		ActiveProfileID: profileIDFromProviderID(input.ActiveProfileID),
		Profiles:        make([]CodexRelayProfileMutation, 0, len(input.Profiles)),
	}
	seen := map[string]bool{}
	for _, profile := range input.Profiles {
		normalized, err := normalizeCodexRelayProfile(profile)
		if err != nil {
			return codexRelayStoredSettings{}, err
		}
		if seen[normalized.ID] {
			return codexRelayStoredSettings{}, fmt.Errorf("%w: duplicate profile id %q", ErrCodexRelayInvalid, normalized.ID)
		}
		seen[normalized.ID] = true
		stored.Profiles = append(stored.Profiles, normalized)
	}
	if stored.ActiveProfileID == "" && len(stored.Profiles) > 0 {
		stored.ActiveProfileID = stored.Profiles[0].ID
	}
	if stored.ActiveProfileID != "" && !seen[stored.ActiveProfileID] {
		return codexRelayStoredSettings{}, fmt.Errorf("%w: active profile is missing", ErrCodexRelayInvalid)
	}
	return stored, nil
}

func normalizeCodexRelayProfile(profile CodexRelayProfileMutation) (CodexRelayProfileMutation, error) {
	name := strings.TrimSpace(profile.Name)
	id := profileIDFromProviderID(profile.ID)
	if id == "" {
		id = profileIDFromProviderID(name)
	}
	if id == "" {
		return CodexRelayProfileMutation{}, fmt.Errorf("%w: profile id is required", ErrCodexRelayInvalid)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(profile.BaseURL), "/")
	if baseURL == "" || !validHTTPURL(baseURL) {
		return CodexRelayProfileMutation{}, fmt.Errorf("%w: baseURL must be an http(s) URL", ErrCodexRelayInvalid)
	}
	model := strings.TrimSpace(profile.Model)
	if model == "" {
		return CodexRelayProfileMutation{}, fmt.Errorf("%w: model is required", ErrCodexRelayInvalid)
	}
	protocol := profile.Protocol
	if protocol == "" {
		protocol = CodexRelayProtocolResponses
	}
	if protocol != CodexRelayProtocolResponses && protocol != CodexRelayProtocolChatCompletions {
		return CodexRelayProfileMutation{}, fmt.Errorf("%w: unsupported protocol", ErrCodexRelayInvalid)
	}
	if name == "" {
		name = id
	}
	return CodexRelayProfileMutation{
		ID:       id,
		Name:     name,
		BaseURL:  baseURL,
		Model:    model,
		Protocol: protocol,
		Enabled:  profile.Enabled,
	}, nil
}

func codexRelayStoredProfileExists(stored codexRelayStoredSettings, profileID string) bool {
	for _, profile := range stored.Profiles {
		if profile.ID == profileID {
			return true
		}
	}
	return false
}

func renderCodexRelayConfig(profile CodexRelayProfileMutation, relayBaseURL string) string {
	baseURL := strings.TrimRight(relayBaseURL, "/") + "/v1"
	return fmt.Sprintf(
		"model = %q\nmodel_provider = %q\n\n[model_providers.%s]\nname = %q\nwire_api = \"responses\"\nrequires_openai_auth = true\nbase_url = %q\nexperimental_bearer_token = %q\n",
		profile.Model,
		codexRelayProviderID,
		codexRelayProviderID,
		codexRelayProviderID,
		baseURL,
		codexRelayLocalBearerToken,
	)
}

func codexRelayUpstreamURL(baseURL string, relayPath string) (string, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	relayPath = "/" + strings.TrimLeft(strings.TrimSpace(relayPath), "/")
	relayPathOnly, rawQuery, _ := strings.Cut(relayPath, "?")
	if baseURL == "" || !validHTTPURL(baseURL) {
		return "", fmt.Errorf("%w: baseURL must be an http(s) URL", ErrCodexRelayInvalid)
	}
	if !codexRelayAllowedPath(relayPathOnly) {
		return "", fmt.Errorf("%w: relay path is not allowed", ErrCodexRelayInvalid)
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("%w: parsing baseURL: %v", ErrCodexRelayInvalid, err)
	}
	suffix := relayPathOnly
	if strings.HasSuffix(parsed.Path, "/v1") && strings.HasPrefix(suffix, "/v1/") {
		suffix = strings.TrimPrefix(suffix, "/v1")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + suffix
	parsed.RawQuery = rawQuery
	parsed.Fragment = ""
	return parsed.String(), nil
}

func codexRelayAllowedPath(path string) bool {
	path = strings.SplitN(path, "?", 2)[0]
	switch path {
	case "/v1/responses", "/responses", "/v1/models", "/models":
		return true
	default:
		return strings.HasPrefix(path, "/v1/responses/") ||
			strings.HasPrefix(path, "/responses/") ||
			strings.HasPrefix(path, "/v1/models/") ||
			strings.HasPrefix(path, "/models/")
	}
}

func validCodexRelayLocalAuthorization(headers http.Header) bool {
	auth := strings.TrimSpace(headers.Get("Authorization"))
	return auth == "Bearer "+codexRelayLocalBearerToken
}

func copyCodexRelayRequestHeaders(target http.Header, source http.Header) {
	for _, key := range []string{"Accept", "Content-Type", "User-Agent", "Cache-Control"} {
		value := source.Get(key)
		if strings.TrimSpace(value) != "" {
			target.Set(key, value)
		}
	}
}

func readCodexRelayBody(reader io.Reader) ([]byte, error) {
	if reader == nil {
		return nil, nil
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("reading codex relay body: %w", err)
	}
	return body, nil
}

func codexRelayCheckStatusOK(status int) bool {
	return status >= http.StatusOK && status < http.StatusMultipleChoices ||
		status == http.StatusNotFound ||
		status == http.StatusMethodNotAllowed
}

func codexRelayCheckStatusAuthFailed(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden
}

func codexRelayBodyLooksInvalidAPIKey(body string) bool {
	normalized := strings.ToLower(body)
	return strings.Contains(normalized, "invalid_api_key") ||
		strings.Contains(normalized, "invalid api key") ||
		strings.Contains(normalized, "incorrect api key")
}

func readLimitedCodexRelayCheckBody(reader io.Reader) string {
	if reader == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(reader, codexRelayCheckBodyLimit))
	if err != nil {
		return ""
	}
	return string(body)
}

func codexRelayModelIDs(body string) []string {
	payload := codexRelayModelsPayload{}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return []string{}
	}
	seen := make(map[string]struct{}, len(payload.Data))
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		model := strings.TrimSpace(item.ID)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		models = append(models, model)
	}
	sort.SliceStable(models, func(left int, right int) bool {
		return codexRelayModelLess(models[left], models[right])
	})
	return models
}

type codexRelayModelSortKey struct {
	isGPT       bool
	major       int
	minor       int
	variantRank int
	normalized  string
}

func codexRelayModelLess(left string, right string) bool {
	leftKey := codexRelayModelKey(left)
	rightKey := codexRelayModelKey(right)
	if leftKey.isGPT != rightKey.isGPT {
		return leftKey.isGPT
	}
	if leftKey.isGPT {
		if leftKey.major != rightKey.major {
			return leftKey.major > rightKey.major
		}
		if leftKey.minor != rightKey.minor {
			return leftKey.minor > rightKey.minor
		}
		if leftKey.variantRank != rightKey.variantRank {
			return leftKey.variantRank < rightKey.variantRank
		}
	}
	return leftKey.normalized < rightKey.normalized
}

func codexRelayModelKey(model string) codexRelayModelSortKey {
	normalized := strings.ToLower(strings.TrimSpace(model))
	key := codexRelayModelSortKey{normalized: normalized, variantRank: 100}
	if !strings.HasPrefix(normalized, "gpt-") {
		return key
	}
	versionAndVariant := strings.TrimPrefix(normalized, "gpt-")
	version, variant, _ := strings.Cut(versionAndVariant, "-")
	parts := strings.Split(version, ".")
	if len(parts) != 2 {
		return key
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	if majorErr != nil || minorErr != nil {
		return key
	}
	variant, _, _ = strings.Cut(variant, "-")
	key.isGPT = true
	key.major = major
	key.minor = minor
	key.variantRank = codexRelayModelVariantRank(variant)
	return key
}

func codexRelayModelVariantRank(variant string) int {
	switch variant {
	case "":
		return 0
	case "sol":
		return 10
	case "terra":
		return 20
	case "luna":
		return 30
	case "pro":
		return 40
	case "codex":
		return 50
	case "mini":
		return 60
	case "nano":
		return 70
	default:
		return 100
	}
}
