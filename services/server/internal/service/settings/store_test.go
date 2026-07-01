package settings

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
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

func TestSettingsListAPIKeysIncludesGenerationAndAgentProviders(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})

	list, err := settings.ListAPIKeys(context.Background())
	if err != nil {
		t.Fatalf("ListAPIKeys returned error: %v", err)
	}

	provider := providerByID(t, list, "deepseek")
	if provider.Configured || provider.Source != "none" {
		t.Fatalf("deepseek provider = %#v, want unconfigured provider", provider)
	}
	if provider.Label != "DeepSeek" ||
		!stringSliceContains(provider.Capabilities, "agent") ||
		!stringSliceContains(provider.Capabilities, "generation") {
		t.Fatalf("deepseek provider = %#v, want generation and agent DeepSeek provider", provider)
	}

	provider = providerByID(t, list, "dmx")
	if provider.Configured || provider.Source != "none" {
		t.Fatalf("dmx provider = %#v, want unconfigured provider", provider)
	}
	if provider.Label != "DMX" ||
		!stringSliceContains(provider.Capabilities, "agent") ||
		!stringSliceContains(provider.Capabilities, "generation") {
		t.Fatalf("dmx provider = %#v, want generation and agent DMX provider", provider)
	}

	provider = providerByID(t, list, "mediago")
	if provider.Label != "MediaGo" ||
		!stringSliceContains(provider.Capabilities, "agent") ||
		!stringSliceContains(provider.Capabilities, "generation") {
		t.Fatalf("mediago provider = %#v, want generation and agent MediaGo provider", provider)
	}
}

func TestSettingsListModelPlatformsDefaultsAndOverrides(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})

	list := settings.ListModelPlatforms(context.Background())
	if len(list.Platforms) != 1 || list.Platforms[0].ID != ModelPlatformMediago {
		t.Fatalf("default platforms = %#v, want mediago only", list.Platforms)
	}
	if len(list.Platforms[0].ModelGroups) == 0 {
		t.Fatalf("default mediago platform groups = %#v, want catalog fallback groups", list.Platforms[0].ModelGroups)
	}

	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter, ModelPlatformDMXAPI})
	list = settings.ListModelPlatforms(context.Background())
	if len(list.Platforms) != 2 ||
		list.Platforms[0].ID != ModelPlatformOpenRouter ||
		list.Platforms[1].APIKeyProviderID != "dmx" {
		t.Fatalf("override platforms = %#v, want openrouter then dmxapi", list.Platforms)
	}
}

func TestSettingsListModelPlatformsUsesMediagoGatewayModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/models/user" {
			t.Fatalf("request path = %q, want /api/v1/models/user", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer mgak-test" {
			t.Fatalf("authorization = %q, want bearer key", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{
			"data": [
				{"id":"glm-5.2","name":"GLM-5.2","kind":"text"},
				{"id":"qwen-mt-plus","name":"Qwen MT Plus","kind":"text"},
				{"id":"doubao-seedream-5-0-lite","name":"Seedream 5.0 Lite","kind":"image"}
			]
		}`)
	}))
	defer server.Close()

	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{
		ModelPlatformMediago: "mgak-test",
	}})
	settings.SetMediagoBaseURL(server.URL + "/api/v1")

	list := settings.ListModelPlatforms(context.Background())
	if len(list.Platforms) != 1 {
		t.Fatalf("platforms = %#v, want one mediago platform", list.Platforms)
	}
	groups := map[string][]string{}
	for _, group := range list.Platforms[0].ModelGroups {
		groups[group.Label] = group.Models
	}
	if !stringSliceContainsFold(groups["智谱 GLM"], "GLM-5.2") ||
		!stringSliceContainsFold(groups["通义千问"], "Qwen MT Plus") ||
		!stringSliceContainsFold(groups["字节"], "Seedream 5.0 Lite") {
		t.Fatalf("model groups = %#v, want gateway vendor groups", list.Platforms[0].ModelGroups)
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

func TestSettingsBeginJimengLoginStoresOAuthMarkerWhenSessionExists(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})
	binPath := filepath.Join(t.TempDir(), "dreamina")
	script := `#!/bin/sh
if [ "$1" = "login" ] && [ "$#" -eq 1 ]; then
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

func TestSettingsJimengBrowserLoginReturnsChallengeAndPersistsAfterCLICompletes(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{}}
	settings := NewSettings(store)
	binPath := filepath.Join(t.TempDir(), "dreamina")
	script := `#!/bin/sh
if [ "$1" = "login" ] && [ "$#" -eq 1 ]; then
  echo "verification_uri: https://example.test/device"
  echo "user_code: ABCD-EFGH"
  echo "device_code: device-123"
  sleep 0.2
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
	if result.Login.Status != "pending" ||
		result.Login.VerificationURI != "https://example.test/device" ||
		result.Login.UserCode != "ABCD-EFGH" {
		t.Fatalf("login = %#v, want parsed browser challenge", result.Login)
	}
	if result.Login.DeviceCode != "" {
		t.Fatalf("login device code = %q, want hidden device code for browser login", result.Login.DeviceCode)
	}
	provider := providerByID(t, APIKeyList{Providers: result.Providers}, "jimeng")
	if provider.Configured {
		t.Fatalf("provider = %#v, want unconfigured while challenge is pending", provider)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		value, _, err := store.Get("jimeng")
		if err != nil {
			t.Fatalf("Get returned error: %v", err)
		}
		if strings.HasPrefix(value, "oauth:") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("jimeng oauth marker was not persisted after login command completed")
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

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
