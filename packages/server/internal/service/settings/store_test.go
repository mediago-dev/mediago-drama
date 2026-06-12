package settings

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

type memoryAPIKeyStore struct {
	values map[string]string
}

func (store *memoryAPIKeyStore) Get(keyName string) (string, string, error) {
	value := store.values[keyName]
	if value == "" {
		return "", "none", nil
	}
	return value, "settings", nil
}

func (store *memoryAPIKeyStore) Set(keyName string, value string) error {
	store.values[keyName] = value
	return nil
}

func (store *memoryAPIKeyStore) Clear(keyName string) error {
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

	list, err = settings.ClearAPIKey(context.Background(), "openrouter")
	if err != nil {
		t.Fatalf("ClearAPIKey returned error: %v", err)
	}
	provider = providerByID(t, list, "openrouter")
	if provider.Configured || provider.Source != "none" || provider.Masked != "" {
		t.Fatalf("provider after clear = %#v, want unconfigured provider", provider)
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

func TestSettingsBeginJimengLoginStoresOAuthMarkerWhenSessionExists(t *testing.T) {
	settings := NewSettings(&memoryAPIKeyStore{values: map[string]string{}})
	binPath := filepath.Join(t.TempDir(), "dreamina")
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\necho '已复用当前本地 OAuth 登录态。'\n"), 0o755); err != nil {
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

func TestSettingsJimengDeviceLoginRequiresCheckBeforeConfigured(t *testing.T) {
	store := &memoryAPIKeyStore{values: map[string]string{"jimeng": "oauth:old"}}
	settings := NewSettings(store)
	binPath := filepath.Join(t.TempDir(), "dreamina")
	script := `#!/bin/sh
if [ "$1" = "relogin" ]; then
  echo "verification_uri: https://example.test/device"
  echo "user_code: ABCD-EFGH"
  echo "device_code: device-123"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "checklogin" ]; then
  echo "[OAuthLogin] login success"
  exit 0
fi
exit 1
`
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake jimeng CLI: %v", err)
	}
	settings.SetJimengCLIPaths(binPath, "")

	result, err := settings.BeginJimengLogin(context.Background(), true)
	if err != nil {
		t.Fatalf("BeginJimengLogin returned error: %v", err)
	}
	if result.Login.Status != "pending" ||
		result.Login.VerificationURI != "https://example.test/device" ||
		result.Login.UserCode != "ABCD-EFGH" ||
		result.Login.DeviceCode != "device-123" {
		t.Fatalf("login = %#v, want parsed device challenge", result.Login)
	}
	provider := providerByID(t, APIKeyList{Providers: result.Providers}, "jimeng")
	if provider.Configured {
		t.Fatalf("provider = %#v, want unconfigured while challenge is pending", provider)
	}

	result, err = settings.CompleteJimengLogin(context.Background(), result.Login.DeviceCode)
	if err != nil {
		t.Fatalf("CompleteJimengLogin returned error: %v", err)
	}
	if result.Login.Status != "completed" {
		t.Fatalf("login = %#v, want completed", result.Login)
	}
	provider = providerByID(t, APIKeyList{Providers: result.Providers}, "jimeng")
	if !provider.Configured || provider.Source != "settings" {
		t.Fatalf("provider = %#v, want configured provider", provider)
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
