package settings

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/libtv"
)

type memoryAPIKeyStore struct {
	mu     sync.RWMutex
	values map[string]string
}

func (store *memoryAPIKeyStore) Get(keyName string) (string, string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	value := store.values[keyName]
	if value == "" {
		return "", "none", nil
	}
	return value, "settings", nil
}

func (store *memoryAPIKeyStore) Set(keyName string, value string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.values[keyName] = value
	return nil
}

func (store *memoryAPIKeyStore) Clear(keyName string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.values, keyName)
	return nil
}

func TestSettingsSetListAndClearAPIKey(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})

	list, err := settings.SetAPIKey(context.Background(), "openrouter", "sk-service")
	if err != nil {
		t.Fatalf("SetAPIKey returned error: %v", err)
	}
	provider := providerByID(t, list, "openrouter")
	if !provider.Configured || provider.Source != "settings" || provider.Masked == "" {
		t.Fatalf("provider after set = %#v, want configured settings provider", provider)
	}
	if !stringSliceContains(provider.Capabilities, "generation") || !stringSliceContains(provider.Capabilities, "agent") {
		t.Fatalf("openrouter capabilities = %#v, want generation and agent", provider.Capabilities)
	}

	list, err = settings.ClearAPIKey(context.Background(), "openrouter")
	if err != nil {
		t.Fatalf("ClearAPIKey returned error: %v", err)
	}
	provider = providerByID(t, list, "openrouter")
	if provider.Configured || provider.Source != "none" || provider.Masked != "" {
		t.Fatalf("provider after clear = %#v, want unconfigured provider", provider)
	}
}

func TestSettingsListAPIKeysExcludesAggregationProvidersOutsideBuildAllowlist(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{
		generation.ProviderMediago:    "mgak-existing",
		generation.ProviderOpenRouter: "sk-openrouter-existing",
		generation.ProviderDMX:        "sk-dmx-existing",
	}})
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})

	list, err := settings.ListAPIKeys(context.Background())
	if err != nil {
		t.Fatalf("ListAPIKeys returned error: %v", err)
	}
	if apiKeyProviderExists(list, generation.ProviderMediago) {
		t.Fatalf("providers = %#v, want MediaGo hidden outside MODEL_PLATFORM", list.Providers)
	}
	if apiKeyProviderExists(list, generation.ProviderDMX) {
		t.Fatalf("providers = %#v, want DMXAPI hidden outside MODEL_PLATFORM", list.Providers)
	}
	if !apiKeyProviderExists(list, generation.ProviderOpenRouter) {
		t.Fatalf("providers = %#v, want enabled OpenRouter platform", list.Providers)
	}
	if !apiKeyProviderExists(list, generation.ProviderOpenAI) {
		t.Fatalf("providers = %#v, want official providers unaffected", list.Providers)
	}
}

func TestSettingsLibTVProjectBindingsPersist(t *testing.T) {
	ctx := context.Background()
	settings := NewSettingsWithStores(
		&memoryAPIKeyStore{values: map[string]string{}},
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)

	if _, ok, err := settings.GetLibTVProjectBinding(ctx, "project-alpha"); err != nil || ok {
		t.Fatalf("empty GetLibTVProjectBinding ok=%v err=%v, want missing without error", ok, err)
	}
	if err := settings.SaveLibTVProjectBinding(ctx, libtv.ProjectBinding{
		InternalProjectID:   "project-alpha",
		InternalProjectName: "天机阁",
		ProjectID:           "22222222-3333-4444-5555-666666666666",
		ProjectName:         "MediaGo - 天机阁",
		CreatedAt:           "2026-07-11T00:00:00Z",
	}); err != nil {
		t.Fatalf("SaveLibTVProjectBinding returned error: %v", err)
	}

	binding, ok, err := settings.GetLibTVProjectBinding(ctx, "project-alpha")
	if err != nil || !ok {
		t.Fatalf("GetLibTVProjectBinding ok=%v err=%v, want stored binding", ok, err)
	}
	if binding.ProjectID != "22222222-3333-4444-5555-666666666666" ||
		binding.InternalProjectName != "天机阁" ||
		binding.ProjectName != "MediaGo - 天机阁" ||
		binding.CreatedAt != "2026-07-11T00:00:00Z" ||
		binding.UpdatedAt == "" {
		t.Fatalf("binding = %#v, want persisted LibTV project binding", binding)
	}
}

func TestSettingsSetAPIKeyValidation(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})

	if _, err := settings.SetAPIKey(context.Background(), "missing", "sk"); err != ErrAPIKeyProviderNotFound {
		t.Fatalf("SetAPIKey missing provider error = %v, want ErrAPIKeyProviderNotFound", err)
	}
	if _, err := settings.SetAPIKey(context.Background(), "openrouter", " "); err != ErrAPIKeyRequired {
		t.Fatalf("SetAPIKey blank key error = %v, want ErrAPIKeyRequired", err)
	}
}

func TestSettingsClearJimengAPIKeyRunsLogout(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{"jimeng": "oauth:old"}}
	settings := NewSettings(store)
	tempDir := t.TempDir()
	argsPath := filepath.Join(tempDir, "args.log")
	binPath := filepath.Join(tempDir, "dreamina")
	script := fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' \"$*\" >> %q\nexit 0\n", argsPath)
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake jimeng CLI: %v", err)
	}
	settings.SetJimengCLIPaths(binPath, "")

	list, err := settings.ClearAPIKey(context.Background(), "jimeng")
	if err != nil {
		t.Fatalf("ClearAPIKey returned error: %v", err)
	}
	provider := providerByID(t, list, "jimeng")
	if provider.Configured || provider.Source != "none" {
		t.Fatalf("provider after clear = %#v, want unconfigured provider", provider)
	}
	output, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake jimeng args: %v", err)
	}
	if strings.TrimSpace(string(output)) != "logout" {
		t.Fatalf("jimeng args = %q, want logout", string(output))
	}
}

func TestSettingsClearLibTVAPIKeyRunsLogout(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{"libtv": "oauth:old"}}
	settings := NewSettings(store)
	settings.SetGenerationCLIs([]string{"libtv"})
	tempDir := t.TempDir()
	argsPath := filepath.Join(tempDir, "args.log")
	binPath := filepath.Join(tempDir, "libtv")
	script := fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' \"$*\" >> %q\nexit 0\n", argsPath)
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake libtv CLI: %v", err)
	}
	settings.SetLibTVCLIPaths(binPath, "")

	list, err := settings.ClearAPIKey(context.Background(), "libtv")
	if err != nil {
		t.Fatalf("ClearAPIKey returned error: %v", err)
	}
	provider := providerByID(t, list, "libtv")
	if provider.Configured || provider.Source != "none" {
		t.Fatalf("provider after clear = %#v, want unconfigured provider", provider)
	}
	output, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake libtv args: %v", err)
	}
	if strings.TrimSpace(string(output)) != "logout" {
		t.Fatalf("libtv args = %q, want logout", string(output))
	}
}

func TestSettingsBeginJimengLoginStoresOAuthMarkerWhenSessionExists(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})
	binPath := filepath.Join(t.TempDir(), "dreamina")
	script := `#!/bin/sh
if [ "$1" = "login" ] && [ "$2" = "--headless" ] && [ "$#" -eq 2 ]; then
  echo '已复用当前本地 OAuth 登录态。'
  exit 0
fi
exit 1
`
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake jimeng CLI: %v", err)
	}
	settings.SetJimengCLIPaths(binPath, "")

	result, err := settings.BeginJimengLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("BeginJimengLogin returned error: %v", err)
	}
	if result.Login.Status != "completed" {
		t.Fatalf("login = %#v, want completed", result.Login)
	}
	provider := providerByID(t, APIKeyList{Providers: result.Providers}, "jimeng")
	if !provider.Configured || provider.Source != "settings" || provider.CredentialKind != "oauth" {
		t.Fatalf("jimeng provider = %#v, want configured oauth provider", provider)
	}
	if provider.Masked != "" {
		t.Fatalf("jimeng provider should not expose masked oauth marker: %#v", provider)
	}
}

func TestSettingsJimengHeadlessLoginReturnsChallengeAndCompletes(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{}}
	settings := NewSettings(store)
	tempDir := t.TempDir()
	argsPath := filepath.Join(tempDir, "args.log")
	binPath := filepath.Join(tempDir, "dreamina")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$*" >> %q
if [ "$1" = "login" ] && [ "$2" = "--headless" ] && [ "$#" -eq 2 ]; then
  echo "verification_uri: https://example.test/device"
  echo "user_code: ABCD-EFGH"
  echo "device_code: device-123"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "checklogin" ]; then
  echo "即梦本地登录态已可用"
  exit 0
fi
exit 1
`, argsPath)
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake jimeng CLI: %v", err)
	}
	settings.SetJimengCLIPaths(binPath, "")

	result, err := settings.BeginJimengLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("BeginJimengLogin returned error: %v", err)
	}
	if result.Login.Status != "pending" ||
		result.Login.VerificationURI != "https://example.test/device" ||
		result.Login.UserCode != "ABCD-EFGH" {
		t.Fatalf("login = %#v, want parsed browser challenge", result.Login)
	}
	if result.Login.DeviceCode != "device-123" {
		t.Fatalf("login device code = %q, want device-123", result.Login.DeviceCode)
	}
	provider := providerByID(t, APIKeyList{Providers: result.Providers}, "jimeng")
	if provider.Configured {
		t.Fatalf("provider = %#v, want unconfigured while challenge is pending", provider)
	}
	value, _, err := store.Get("jimeng")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if value != "" {
		t.Fatalf("stored jimeng marker = %q, want empty before confirmation", value)
	}

	completed, err := settings.CompleteJimengLogin(context.Background(), result.Login.DeviceCode)
	if err != nil {
		t.Fatalf("CompleteJimengLogin returned error: %v", err)
	}
	if completed.Login.Status != "completed" {
		t.Fatalf("completed login = %#v, want completed", completed.Login)
	}
	provider = providerByID(t, APIKeyList{Providers: completed.Providers}, "jimeng")
	if !provider.Configured {
		t.Fatalf("provider = %#v, want configured after confirmation", provider)
	}
	output, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake jimeng args: %v", err)
	}
	wantArgs := "login --headless\nlogin checklogin --device_code=device-123 --poll=30"
	if strings.TrimSpace(string(output)) != wantArgs {
		t.Fatalf("jimeng args = %q, want %q", strings.TrimSpace(string(output)), wantArgs)
	}
}

func TestSettingsBeginLibTVLoginReturnsChallengeAndPersistsAfterCLICompletes(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{}}
	settings := NewSettings(store)
	settings.SetGenerationCLIs([]string{"libtv"})
	binPath := filepath.Join(t.TempDir(), "libtv")
	script := `#!/bin/sh
if [ "$1" = "login" ] && [ "$2" = "web" ] && [ "$#" -eq 2 ]; then
  echo "Open https://libtv.example.test/login in your browser"
  sleep 0.2
  exit 0
fi
exit 1
`
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake libtv CLI: %v", err)
	}
	settings.SetLibTVCLIPaths(binPath, "")

	result, err := settings.BeginLibTVLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("BeginLibTVLogin returned error: %v", err)
	}
	if result.Login.Status != "pending" ||
		result.Login.VerificationURI != "https://libtv.example.test/login" {
		t.Fatalf("login = %#v, want parsed LibTV browser challenge", result.Login)
	}
	if result.Login.DeviceCode != "" {
		t.Fatalf("login device code = %q, want empty device code", result.Login.DeviceCode)
	}
	provider := providerByID(t, APIKeyList{Providers: result.Providers}, "libtv")
	if provider.Configured {
		t.Fatalf("provider = %#v, want unconfigured while challenge is pending", provider)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		value, _, err := store.Get("libtv")
		if err != nil {
			t.Fatalf("Get returned error: %v", err)
		}
		if strings.HasPrefix(value, "oauth:") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("libtv oauth marker was not persisted after login command completed")
}

func TestSettingsLibTVPendingLoginCanBeReplacedAndClearedForRetry(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{}}
	settings := NewSettings(store)
	settings.SetGenerationCLIs([]string{"libtv"})
	tempDir := t.TempDir()
	argsPath := filepath.Join(tempDir, "args.log")
	pidsPath := filepath.Join(tempDir, "pids.log")
	currentPIDPath := filepath.Join(tempDir, "current.pid")
	binPath := filepath.Join(tempDir, "libtv")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$*" >> %q
if [ "$1" = "login" ] && [ "$2" = "web" ] && [ "$#" -eq 2 ]; then
  if [ -f %q ]; then
    current_pid=$(cat %q)
    if kill -0 "$current_pid" 2>/dev/null; then
      echo "LibTV login is already running" >&2
      exit 23
    fi
  fi
  echo $$ > %q
  echo $$ >> %q
  echo "Open https://libtv.example.test/login in your browser"
  while :; do sleep 1; done
fi
if [ "$1" = "logout" ] && [ "$#" -eq 1 ]; then
  exit 0
fi
exit 1
`, argsPath, currentPIDPath, currentPIDPath, currentPIDPath, pidsPath)
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake libtv CLI: %v", err)
	}
	t.Cleanup(func() {
		output, _ := os.ReadFile(pidsPath)
		for _, line := range strings.Fields(string(output)) {
			pid, err := strconv.Atoi(line)
			if err != nil {
				continue
			}
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	})
	settings.SetLibTVCLIPaths(binPath, "")

	first, err := settings.BeginLibTVLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("first BeginLibTVLogin returned error: %v", err)
	}
	if first.Login.Status != "pending" {
		t.Fatalf("first login = %#v, want pending", first.Login)
	}
	second, err := settings.BeginLibTVLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("second BeginLibTVLogin returned error: %v", err)
	}
	if second.Login.Status != "pending" {
		t.Fatalf("second login = %#v, want pending", second.Login)
	}
	if _, err := settings.ClearAPIKey(context.Background(), "libtv"); err != nil {
		t.Fatalf("ClearAPIKey returned error: %v", err)
	}

	third, err := settings.BeginLibTVLogin(context.Background(), false)
	if err != nil {
		t.Fatalf("third BeginLibTVLogin returned error: %v", err)
	}
	if third.Login.Status != "pending" {
		t.Fatalf("third login = %#v, want pending", third.Login)
	}
	if _, err := settings.ClearAPIKey(context.Background(), "libtv"); err != nil {
		t.Fatalf("second ClearAPIKey returned error: %v", err)
	}

	output, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake libtv args: %v", err)
	}
	wantArgs := "login web\nlogin web\nlogout\nlogin web\nlogout"
	if strings.TrimSpace(string(output)) != wantArgs {
		t.Fatalf("libtv args = %q, want %q", strings.TrimSpace(string(output)), wantArgs)
	}
}

func providerByID(t *testing.T, list APIKeyList, id string) APIKeyProvider {
	t.Helper()
	for _, provider := range list.Providers {
		if provider.ID == id {
			return provider
		}
	}
	t.Fatalf("provider %q not found", id)
	return APIKeyProvider{}
}

func modelPlatformExists(list ModelPlatformList, id string) bool {
	for _, platform := range list.Platforms {
		if platform.ID == id {
			return true
		}
	}
	return false
}

func apiKeyProviderExists(list APIKeyList, id string) bool {
	for _, provider := range list.Providers {
		if provider.ID == id {
			return true
		}
	}
	return false
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestSettingsSupportedChannelsAndLegacyCredentials(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{"mediago": "old-key", "dmx": "old-key", "xiaoyunque": "old-key"}}
	settings := NewSettings(store)
	settings.SetGenerationCLIs([]string{"dreamina", "libtv"})
	list, err := settings.ListAPIKeys(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"openrouter", "openai", "google", "jimeng", "libtv"} {
		providerByID(t, list, id)
	}
	for _, id := range []string{"mediago", "dmx", "dmxapi", "xiaoyunque", "pippit"} {
		if apiKeyProviderExists(list, id) {
			t.Errorf("removed provider %q is visible", id)
		}
		if settings.GenerationProviderEnabled(id) {
			t.Errorf("removed provider %q is enabled", id)
		}
		if _, err := settings.SetAPIKey(context.Background(), id, "new-key"); err == nil {
			t.Errorf("removed provider %q accepted a credential", id)
		}
	}
	platforms := settings.ListModelPlatforms(context.Background())
	if len(platforms.Platforms) != 3 || platforms.Platforms[0].ID != "openrouter" {
		t.Fatalf("platforms = %#v", platforms)
	}
	if store.values["mediago"] != "old-key" {
		t.Fatal("historical credentials were modified")
	}
	settings.SetModelPlatforms([]string{})
	if settings.GenerationProviderEnabled("openrouter") {
		t.Fatal("disabled aggregation provider is enabled")
	}
	if !settings.GenerationProviderEnabled("openai") {
		t.Fatal("official provider was disabled")
	}
}

func TestParseSupportedGenerationCLIsAndModelPlatforms(t *testing.T) {
	got, err := ParseGenerationCLIProviderIDs("dreamina,jimeng,libtv")
	if err != nil || strings.Join(got, ",") != "jimeng,libtv" {
		t.Fatalf("CLI ids = %v, %v", got, err)
	}
	for _, id := range []string{"pippit", "xiaoyunque", "pippit-tool-cli"} {
		if _, err := ParseGenerationCLIProviderIDs(id); err == nil {
			t.Errorf("removed CLI %q was accepted", id)
		}
	}
	for _, id := range []string{"mediago", "dmxapi", "xiaoyunque"} {
		if _, err := ParseModelPlatformIDs(id); err == nil {
			t.Errorf("removed platform %q was accepted", id)
		}
	}
}
