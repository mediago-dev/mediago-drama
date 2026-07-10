package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/jimeng"
)

// Settings errors returned by the settings service.
var (
	ErrAPIKeyProviderNotFound  = errors.New("api key provider not found")
	ErrAPIKeyRequired          = errors.New("apiKey is required")
	ErrProviderLoginRequired   = errors.New("provider login challenge is required")
	ErrAgentModelStoreMissing  = errors.New("agent model profile store is unavailable")
	ErrAgentModelNotFound      = errors.New("agent model profile not found")
	ErrAgentModelInvalid       = errors.New("agent model profile is invalid")
	ErrAgentModelConflict      = errors.New("agent model provider id already exists")
	ErrAppSettingStoreMissing  = errors.New("app setting store is unavailable")
	ErrCodexRelayInvalid       = errors.New("codex relay settings are invalid")
	ErrCodexRelayNotConfigured = errors.New("codex relay is not configured")
	ErrCodexRelayCheckFailed   = errors.New("Codex 中转配置不可用")
	ErrCodexRelayUnauthorized  = errors.New("codex relay request is unauthorized")
	ErrJianyingDraftInvalid    = errors.New("jianying draft settings are invalid")
)

const (
	jimengLoginStartTimeout   = 60 * time.Second
	jimengLoginCheckTimeout   = 45 * time.Second
	jimengLoginProcessTimeout = 10 * time.Minute
	jimengLogoutTimeout       = 30 * time.Second
	libTVLoginStartTimeout    = 60 * time.Second
	libTVLoginProcessTimeout  = 10 * time.Minute
	libTVLogoutTimeout        = 30 * time.Second
)

var urlPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

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

// AppSettingStore persists non-secret app settings.
type AppSettingStore interface {
	GetAppSetting(key string) (string, bool, error)
	SetAppSetting(key string, value string) error
	ClearAppSetting(key string) error
}

// APIKeyProvider describes one configurable API key provider.
type APIKeyProvider struct {
	ID              string   `json:"id"`
	Label           string   `json:"label"`
	Description     string   `json:"description"`
	Configured      bool     `json:"configured"`
	Source          string   `json:"source"`
	Masked          string   `json:"masked,omitempty"`
	CredentialLabel string   `json:"credentialLabel,omitempty"`
	Placeholder     string   `json:"placeholder,omitempty"`
	Help            string   `json:"help,omitempty"`
	CredentialKind  string   `json:"credentialKind,omitempty"`
	Capabilities    []string `json:"capabilities,omitempty"`
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

// JianyingDraftSettings describes the local Jianying draft folder settings.
type JianyingDraftSettings struct {
	DraftsRoot string `json:"draftsRoot"`
}

// Settings provides settings workflows.
type Settings struct {
	apiKeys                  APIKeyStore
	agentProfiles            AgentModelProfileStore
	appSettings              AppSettingStore
	modelPlatformIDs         []string
	generationCLIProviderIDs []string
	mediagoBaseURL           string
	jimengBinPath            string
	jimengBinDir             string
	libTVBinPath             string
	libTVBinDir              string
	pippitBinPath            string
	pippitBinDir             string
}

// NewSettings creates a settings service.
func NewSettings(apiKeys APIKeyStore) *Settings {
	return NewSettingsWithAgentModelProfiles(apiKeys, nil)
}

// NewSettingsWithAgentModelProfiles creates a settings service with agent model profile storage.
func NewSettingsWithAgentModelProfiles(apiKeys APIKeyStore, agentProfiles AgentModelProfileStore) *Settings {
	return NewSettingsWithStores(apiKeys, agentProfiles, nil)
}

// NewSettingsWithStores creates a settings service with all settings-backed stores.
func NewSettingsWithStores(apiKeys APIKeyStore, agentProfiles AgentModelProfileStore, appSettings AppSettingStore) *Settings {
	return &Settings{apiKeys: apiKeys, agentProfiles: agentProfiles, appSettings: appSettings}
}

// SetJimengCLIPaths configures the local Jimeng CLI lookup paths.
func (service *Settings) SetJimengCLIPaths(binPath string, binDir string) {
	service.jimengBinPath = strings.TrimSpace(binPath)
	service.jimengBinDir = strings.TrimSpace(binDir)
}

// SetLibTVCLIPaths configures the local LibTV CLI lookup paths.
func (service *Settings) SetLibTVCLIPaths(binPath string, binDir string) {
	service.libTVBinPath = strings.TrimSpace(binPath)
	service.libTVBinDir = strings.TrimSpace(binDir)
}

// SetPippitCLIPaths configures the local Pippit / Xiaoyunque CLI lookup paths.
func (service *Settings) SetPippitCLIPaths(binPath string, binDir string) {
	service.pippitBinPath = strings.TrimSpace(binPath)
	service.pippitBinDir = strings.TrimSpace(binDir)
}

const jianyingDraftRootSettingKey = "jianyingdraft.drafts_root"

// GetJianyingDraftSettings returns the saved Jianying draft folder settings.
func (service *Settings) GetJianyingDraftSettings(ctx context.Context) (JianyingDraftSettings, error) {
	_ = ctx
	if service.appSettings == nil {
		return JianyingDraftSettings{}, ErrAppSettingStoreMissing
	}
	value, _, err := service.appSettings.GetAppSetting(jianyingDraftRootSettingKey)
	if err != nil {
		return JianyingDraftSettings{}, err
	}
	return JianyingDraftSettings{DraftsRoot: strings.TrimSpace(value)}, nil
}

// SetJianyingDraftSettings stores the Jianying draft folder settings.
func (service *Settings) SetJianyingDraftSettings(ctx context.Context, input JianyingDraftSettings) (JianyingDraftSettings, error) {
	_ = ctx
	if service.appSettings == nil {
		return JianyingDraftSettings{}, ErrAppSettingStoreMissing
	}
	draftsRoot, err := normalizeJianyingDraftRoot(input.DraftsRoot)
	if err != nil {
		return JianyingDraftSettings{}, fmt.Errorf("%w: %v", ErrJianyingDraftInvalid, err)
	}
	if draftsRoot == "" {
		if err := service.appSettings.ClearAppSetting(jianyingDraftRootSettingKey); err != nil {
			return JianyingDraftSettings{}, err
		}
		return JianyingDraftSettings{}, nil
	}
	if err := service.appSettings.SetAppSetting(jianyingDraftRootSettingKey, draftsRoot); err != nil {
		return JianyingDraftSettings{}, err
	}
	return JianyingDraftSettings{DraftsRoot: draftsRoot}, nil
}

func normalizeJianyingDraftRoot(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolving drafts root: %w", err)
	}
	if info, err := os.Stat(absolute); err == nil {
		if !info.IsDir() {
			return "", fmt.Errorf("drafts root is not a directory: %s", absolute)
		}
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("checking drafts root: %w", err)
	}
	return absolute, nil
}

// ListAPIKeys lists all providers with their configured state.
func (service *Settings) ListAPIKeys(ctx context.Context) (APIKeyList, error) {
	_ = ctx
	providers := service.apiKeyProviders()
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
	provider, ok := service.findAPIKeyProvider(providerID)
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
	provider, ok := service.findAPIKeyProvider(providerID)
	if !ok {
		return APIKeyList{}, ErrAPIKeyProviderNotFound
	}
	switch provider.ID {
	case generation.ProviderJimeng:
		if _, err := service.runJimengCommand(ctx, jimengLogoutTimeout, "logout"); err != nil {
			return APIKeyList{}, err
		}
	case generation.ProviderLibTV:
		if _, err := service.runLibTVCommand(ctx, libTVLogoutTimeout, "logout"); err != nil {
			return APIKeyList{}, err
		}
	}
	if err := service.apiKeys.Clear(provider.keyName); err != nil {
		return APIKeyList{}, err
	}
	return service.ListAPIKeys(ctx)
}

// BeginJimengLogin starts the local Jimeng OAuth device login flow.
func (service *Settings) BeginJimengLogin(ctx context.Context, force bool) (APIKeyLoginResult, error) {
	_ = force
	if _, ok := service.findAPIKeyProvider(generation.ProviderJimeng); !ok {
		return APIKeyLoginResult{}, ErrAPIKeyProviderNotFound
	}
	login, waitDone, output, err := service.startJimengLogin(ctx)
	if err != nil {
		return APIKeyLoginResult{}, err
	}
	if login.Status == "pending" {
		if err := service.apiKeys.Clear(generation.ProviderJimeng); err != nil {
			return APIKeyLoginResult{}, err
		}
		go service.persistJimengLoginWhenDone(waitDone)
		return service.apiKeyLoginResult(ctx, login)
	}
	if err := service.apiKeys.Set(generation.ProviderJimeng, "oauth:"+time.Now().UTC().Format(time.RFC3339)); err != nil {
		return APIKeyLoginResult{}, err
	}
	if login.Status == "" {
		login.Status = "completed"
	}
	if login.Message == "" {
		login.Message = strings.TrimSpace(output)
	}
	if login.Message == "" {
		login.Message = "即梦本地登录态已可用"
	}
	return service.apiKeyLoginResult(ctx, login)
}

func (service *Settings) startJimengLogin(ctx context.Context) (ProviderLoginChallenge, <-chan error, string, error) {
	binPath, err := jimeng.ResolveBinaryPath(service.jimengBinPath, service.jimengBinDir)
	if err != nil {
		return ProviderLoginChallenge{}, nil, "", err
	}

	processCtx, cancelProcess := context.WithTimeout(context.Background(), jimengLoginProcessTimeout)
	command := exec.CommandContext(processCtx, binPath, "login")
	output := newCommandOutputWatcher()
	command.Stdout = output
	command.Stderr = output
	if err := command.Start(); err != nil {
		cancelProcess()
		return ProviderLoginChallenge{}, nil, "", err
	}

	done := make(chan error, 1)
	go func() {
		err := command.Wait()
		cancelProcess()
		done <- err
	}()

	startTimer := time.NewTimer(jimengLoginStartTimeout)
	defer startTimer.Stop()

	for {
		select {
		case text := <-output.updates:
			login := parseJimengLoginChallenge([]byte(text))
			if login.Status == "pending" && login.VerificationURI != "" && login.UserCode != "" {
				login.DeviceCode = ""
				if login.Message == "" {
					login.Message = "即梦登录链接已生成，请在浏览器中完成登录。"
				}
				return login, done, text, nil
			}
		case err := <-done:
			text := output.String()
			if err != nil {
				return ProviderLoginChallenge{}, nil, text, jimengCommandError("login", err, text)
			}
			login := parseJimengLoginChallenge([]byte(text))
			login.Status = "completed"
			login.DeviceCode = ""
			return login, nil, text, nil
		case <-startTimer.C:
			cancelProcess()
			return ProviderLoginChallenge{}, nil, output.String(), jimengCommandError("login", context.DeadlineExceeded, output.String())
		case <-ctx.Done():
			cancelProcess()
			return ProviderLoginChallenge{}, nil, output.String(), ctx.Err()
		}
	}
}

func (service *Settings) persistJimengLoginWhenDone(done <-chan error) {
	service.persistOAuthLoginWhenDone(generation.ProviderJimeng, done)
}

func (service *Settings) persistOAuthLoginWhenDone(providerID string, done <-chan error) {
	if done == nil {
		return
	}
	if err := <-done; err != nil {
		return
	}
	_ = service.apiKeys.Set(providerID, "oauth:"+time.Now().UTC().Format(time.RFC3339))
}

// CompleteJimengLogin checks a prior Jimeng OAuth device login and stores a local session marker.
func (service *Settings) CompleteJimengLogin(ctx context.Context, deviceCode string) (APIKeyLoginResult, error) {
	if _, ok := service.findAPIKeyProvider(generation.ProviderJimeng); !ok {
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

// BeginLibTVLogin starts the local LibTV web login flow.
func (service *Settings) BeginLibTVLogin(ctx context.Context, force bool) (APIKeyLoginResult, error) {
	_ = force
	if _, ok := service.findAPIKeyProvider(generation.ProviderLibTV); !ok {
		return APIKeyLoginResult{}, ErrAPIKeyProviderNotFound
	}
	login, waitDone, output, err := service.startLibTVLogin(ctx)
	if err != nil {
		return APIKeyLoginResult{}, err
	}
	if login.Status == "pending" {
		if err := service.apiKeys.Clear(generation.ProviderLibTV); err != nil {
			return APIKeyLoginResult{}, err
		}
		go service.persistOAuthLoginWhenDone(generation.ProviderLibTV, waitDone)
		return service.apiKeyLoginResult(ctx, login)
	}
	if err := service.apiKeys.Set(generation.ProviderLibTV, "oauth:"+time.Now().UTC().Format(time.RFC3339)); err != nil {
		return APIKeyLoginResult{}, err
	}
	if login.Status == "" {
		login.Status = "completed"
	}
	if login.Message == "" {
		login.Message = strings.TrimSpace(output)
	}
	if login.Message == "" {
		login.Message = "LibTV 本地登录态已可用"
	}
	return service.apiKeyLoginResult(ctx, login)
}

func (service *Settings) startLibTVLogin(ctx context.Context) (ProviderLoginChallenge, <-chan error, string, error) {
	binPath, err := service.resolveLibTVBinary()
	if err != nil {
		return ProviderLoginChallenge{}, nil, "", err
	}

	processCtx, cancelProcess := context.WithTimeout(context.Background(), libTVLoginProcessTimeout)
	command := exec.CommandContext(processCtx, binPath, "login", "web")
	output := newCommandOutputWatcher()
	command.Stdout = output
	command.Stderr = output
	if err := command.Start(); err != nil {
		cancelProcess()
		return ProviderLoginChallenge{}, nil, "", err
	}

	done := make(chan error, 1)
	go func() {
		err := command.Wait()
		cancelProcess()
		done <- err
	}()

	startTimer := time.NewTimer(libTVLoginStartTimeout)
	defer startTimer.Stop()

	for {
		select {
		case text := <-output.updates:
			login := parseLibTVLoginChallenge([]byte(text))
			if login.Status == "pending" && login.VerificationURI != "" {
				if login.Message == "" {
					login.Message = "LibTV 登录链接已生成，请在浏览器中完成登录。"
				}
				return login, done, text, nil
			}
		case err := <-done:
			text := output.String()
			if err != nil {
				return ProviderLoginChallenge{}, nil, text, localCLICommandError("libtv", "login web", err, text)
			}
			login := parseLibTVLoginChallenge([]byte(text))
			login.Status = "completed"
			return login, nil, text, nil
		case <-startTimer.C:
			cancelProcess()
			return ProviderLoginChallenge{}, nil, output.String(), localCLICommandError("libtv", "login web", context.DeadlineExceeded, output.String())
		case <-ctx.Done():
			cancelProcess()
			return ProviderLoginChallenge{}, nil, output.String(), ctx.Err()
		}
	}
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
		return output, jimengCommandError(strings.Join(args, " "), err, string(output))
	}
	return output, nil
}

func (service *Settings) runLibTVCommand(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	binPath, err := service.resolveLibTVBinary()
	if err != nil {
		return nil, err
	}

	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandCtx, binPath, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return output, localCLICommandError("libtv", strings.Join(args, " "), err, string(output))
	}
	return output, nil
}

func (service *Settings) resolveLibTVBinary() (string, error) {
	return resolveLocalCLIBinary("LibTV", service.libTVBinPath, service.libTVBinDir, "libtv", "libtv")
}

func jimengCommandError(commandName string, err error, output string) error {
	message := strings.TrimSpace(output)
	if message == "" {
		return fmt.Errorf("jimeng %s failed: %w", commandName, err)
	}
	return fmt.Errorf("jimeng %s failed: %w: %s", commandName, err, message)
}

func localCLICommandError(cliName string, commandName string, err error, output string) error {
	message := strings.TrimSpace(output)
	if message == "" {
		return fmt.Errorf("%s %s failed: %w", cliName, commandName, err)
	}
	return fmt.Errorf("%s %s failed: %w: %s", cliName, commandName, err, message)
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
	if login.VerificationURI == "" {
		login.VerificationURI = firstURL(text)
	}
	if login.VerificationURI != "" || login.UserCode != "" || login.DeviceCode != "" {
		login.Status = "pending"
		return login
	}
	login.Status = "completed"
	return login
}

func parseLibTVLoginChallenge(output []byte) ProviderLoginChallenge {
	login := parseJimengLoginChallenge(output)
	login.DeviceCode = ""
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

func firstURL(output string) string {
	value := urlPattern.FindString(output)
	return strings.TrimRight(value, ".,;:)]}，。；：")
}

func resolveLocalCLIBinary(label string, explicitPath string, binDir string, toolID string, binaryName string) (string, error) {
	binaryName = localCLIExecutableName(binaryName)
	if explicitPath = strings.TrimSpace(explicitPath); explicitPath != "" {
		return localCLIExecutableFile(label, explicitPath)
	}
	if binDir = strings.TrimSpace(binDir); binDir != "" {
		candidates := []string{
			filepath.Join(binDir, toolID, binaryName),
			filepath.Join(binDir, binaryName),
		}
		for _, candidate := range candidates {
			if path, err := localCLIExecutableFile(label, candidate); err == nil {
				return path, nil
			}
		}
	}

	path, err := exec.LookPath(binaryName)
	if err != nil {
		return "", fmt.Errorf("%s binary %q was not found", label, binaryName)
	}
	return path, nil
}

func localCLIExecutableName(name string) string {
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(name), ".exe") {
		return name + ".exe"
	}
	return name
}

func localCLIExecutableFile(label string, path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolving %s path %s: %w", label, path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s path %s is a directory", label, resolved)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("%s path %s is not executable", label, resolved)
	}
	return resolved, nil
}

type commandOutputWatcher struct {
	mu      sync.Mutex
	output  strings.Builder
	updates chan string
}

func newCommandOutputWatcher() *commandOutputWatcher {
	return &commandOutputWatcher{updates: make(chan string, 1)}
}

func (watcher *commandOutputWatcher) Write(bytes []byte) (int, error) {
	watcher.mu.Lock()
	watcher.output.Write(bytes)
	text := watcher.output.String()
	watcher.mu.Unlock()

	select {
	case watcher.updates <- text:
	default:
		select {
		case <-watcher.updates:
		default:
		}
		select {
		case watcher.updates <- text:
		default:
		}
	}
	return len(bytes), nil
}

func (watcher *commandOutputWatcher) String() string {
	watcher.mu.Lock()
	defer watcher.mu.Unlock()
	return watcher.output.String()
}

// GetAPIKey returns an API key by provider key name.
func (service *Settings) GetAPIKey(ctx context.Context, keyName string) (string, string, error) {
	_ = ctx
	return service.apiKeys.Get(keyName)
}

// ProviderLabel returns a display label for a provider key name.
func (service *Settings) ProviderLabel(keyName string) string {
	provider, ok := service.findAPIKeyProvider(keyName)
	if !ok {
		provider, ok = findAPIKeyProvider(keyName)
	}
	if ok && provider.Label != "" {
		return provider.Label
	}
	return keyName
}

func (service *Settings) apiKeyProviders() []APIKeyProvider {
	providers := apiKeyProviders()
	enabledCLIProviders := enabledGenerationCLIProviderSet(service.GenerationCLIProviderIDs())
	filtered := make([]APIKeyProvider, 0, len(providers))
	for _, provider := range providers {
		if isGenerationCLIProvider(provider.ID) && !enabledCLIProviders[provider.ID] {
			continue
		}
		filtered = append(filtered, provider)
	}
	return filtered
}

func apiKeyProviders() []APIKeyProvider {
	specs := generation.CredentialSpecs()
	providers := make([]APIKeyProvider, 0, len(specs)+1)
	for _, spec := range specs {
		providers = append(providers, APIKeyProvider{
			ID:              spec.ID,
			Label:           spec.Label,
			Description:     spec.Description,
			CredentialLabel: spec.CredentialLabel,
			Placeholder:     spec.Placeholder,
			Help:            spec.Help,
			CredentialKind:  spec.CredentialKind,
			Capabilities:    apiKeyProviderCapabilities(spec.ID, true),
			keyName:         spec.ID,
		})
	}

	if _, ok := generation.FindCredentialSpec(agentModelProviderDeepSeek); !ok {
		providers = append(providers, APIKeyProvider{
			ID:              agentModelProviderDeepSeek,
			Label:           "DeepSeek",
			Description:     "DeepSeek agent routes",
			CredentialLabel: "DeepSeek API Key",
			Placeholder:     "输入 DeepSeek API Key",
			Help:            "用于智能体默认 DeepSeek Chat 模型。",
			Capabilities:    apiKeyProviderCapabilities(agentModelProviderDeepSeek, false),
			keyName:         agentModelProviderDeepSeek,
		})
	}

	return providers
}

func apiKeyProviderCapabilities(providerID string, supportsGeneration bool) []string {
	capabilities := []string{}
	if supportsGeneration {
		capabilities = append(capabilities, "generation")
	}
	if supportsOfficialAgentModel(providerID) {
		capabilities = append(capabilities, "agent")
	}
	return capabilities
}

func findAPIKeyProvider(id string) (APIKeyProvider, bool) {
	for _, provider := range apiKeyProviders() {
		if provider.ID == id {
			return provider, true
		}
	}

	return APIKeyProvider{}, false
}

func (service *Settings) findAPIKeyProvider(id string) (APIKeyProvider, bool) {
	for _, provider := range service.apiKeyProviders() {
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
