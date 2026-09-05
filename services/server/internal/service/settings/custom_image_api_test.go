package settings

import (
	"context"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/whereslowimage"
)

func TestCustomImageAPISettingsPersistWithoutExposingKey(t *testing.T) {
	keyStore := &memoryAPIKeyStore{values: map[string]string{}}
	service := NewSettingsWithStores(keyStore, nil, &memoryAppSettingStore{values: map[string]string{}})

	result, err := service.SetCustomImageAPISettings(context.Background(), CustomImageAPISettingsInput{
		BaseURL:  "https://cn.whereslow.online/",
		APIKey:   "sk-custom-secret",
		Model:    "nano-banana-2",
		Protocol: whereslowimage.ProtocolGemini,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.BaseURL != "https://cn.whereslow.online" || result.Model != "nano-banana-2" || result.Protocol != whereslowimage.ProtocolGemini {
		t.Fatalf("result = %#v", result)
	}
	if !result.APIKey.Configured || result.APIKey.Masked == "" || result.APIKey.Masked == "sk-custom-secret" {
		t.Fatalf("key status = %#v", result.APIKey)
	}
	if keyStore.values[coregeneration.ProviderWhereslowImage] != "sk-custom-secret" {
		t.Fatal("custom image key was not stored in its independent credential slot")
	}
	if !service.CustomImageAPIConfigured(context.Background()) {
		t.Fatal("custom image API should be configured")
	}
}

func TestCustomImageAPISettingsPreservesExistingKeyWhenInputIsBlank(t *testing.T) {
	keyStore := &memoryAPIKeyStore{values: map[string]string{coregeneration.ProviderWhereslowImage: "existing"}}
	service := NewSettingsWithStores(keyStore, nil, &memoryAppSettingStore{values: map[string]string{}})
	_, err := service.SetCustomImageAPISettings(context.Background(), CustomImageAPISettingsInput{
		BaseURL:  "https://cn.whereslow.online",
		Model:    "nano-banana-2",
		Protocol: whereslowimage.ProtocolGemini,
	})
	if err != nil {
		t.Fatal(err)
	}
	if keyStore.values[coregeneration.ProviderWhereslowImage] != "existing" {
		t.Fatal("blank API key replaced the saved secret")
	}
}
