package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/whereslowimage"
)

const customImageAPISettingKey = "generation.whereslow_image_api"
const whereslowImageModel = "nano-banana-2"

// CustomImageAPIKeyStatus describes the saved secret without exposing it.
type CustomImageAPIKeyStatus struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"`
	Masked     string `json:"masked,omitempty"`
}

// CustomImageAPISettings configures the image-only custom provider.
type CustomImageAPISettings struct {
	BaseURL  string                  `json:"baseURL"`
	Model    string                  `json:"model"`
	Protocol whereslowimage.Protocol `json:"protocol"`
	APIKey   CustomImageAPIKeyStatus `json:"apiKey"`
}

// CustomImageAPISettingsInput updates the non-secret settings and optionally the API key.
type CustomImageAPISettingsInput struct {
	BaseURL  string                  `json:"baseURL"`
	Model    string                  `json:"model"`
	Protocol whereslowimage.Protocol `json:"protocol"`
	APIKey   string                  `json:"apiKey,omitempty"`
}

type storedCustomImageAPISettings struct {
	BaseURL  string                  `json:"baseURL"`
	Model    string                  `json:"model"`
	Protocol whereslowimage.Protocol `json:"protocol"`
}

// GetCustomImageAPISettings returns custom image settings with a masked key status.
func (service *Settings) GetCustomImageAPISettings(ctx context.Context) (CustomImageAPISettings, error) {
	_ = ctx
	stored := storedCustomImageAPISettings{
		BaseURL:  "https://cn.whereslow.online",
		Model:    whereslowImageModel,
		Protocol: whereslowimage.ProtocolGemini,
	}
	if service.appSettings == nil {
		return CustomImageAPISettings{}, ErrAppSettingStoreMissing
	}
	if raw, ok, err := service.appSettings.GetAppSetting(customImageAPISettingKey); err != nil {
		return CustomImageAPISettings{}, err
	} else if ok && strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &stored); err != nil {
			return CustomImageAPISettings{}, fmt.Errorf("decoding custom image API settings: %w", err)
		}
	}
	// This provider exposes one image model. Normalize legacy saved settings so
	// an older model value cannot keep routing requests to a retired model.
	stored.Model = whereslowImageModel
	key, source, err := service.apiKeys.Get(coregeneration.ProviderWhereslowImage)
	if err != nil {
		return CustomImageAPISettings{}, err
	}
	return CustomImageAPISettings{
		BaseURL:  stored.BaseURL,
		Model:    stored.Model,
		Protocol: stored.Protocol,
		APIKey: CustomImageAPIKeyStatus{
			Configured: strings.TrimSpace(key) != "",
			Source:     source,
			Masked:     maskAPIKey(key),
		},
	}, nil
}

// SetCustomImageAPISettings validates and stores image-only custom API settings.
func (service *Settings) SetCustomImageAPISettings(ctx context.Context, input CustomImageAPISettingsInput) (CustomImageAPISettings, error) {
	if service.appSettings == nil {
		return CustomImageAPISettings{}, ErrAppSettingStoreMissing
	}
	baseURL := strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return CustomImageAPISettings{}, fmt.Errorf("API Base URL 必须是有效的 HTTP(S) 地址")
	}
	if baseURL != "https://cn.whereslow.online" || (parsed.Path != "" && parsed.Path != "/") {
		return CustomImageAPISettings{}, fmt.Errorf("API Base URL 必须是 https://cn.whereslow.online，不能填写 /keys 管理页")
	}
	model := strings.TrimSpace(input.Model)
	if model == "" {
		return CustomImageAPISettings{}, fmt.Errorf("Model 不能为空")
	}
	if strings.ContainsAny(model, "\r\n") {
		return CustomImageAPISettings{}, fmt.Errorf("Model 不合法")
	}
	if model != whereslowImageModel {
		return CustomImageAPISettings{}, fmt.Errorf("Model 必须是 %s", whereslowImageModel)
	}
	if input.Protocol != whereslowimage.ProtocolGemini {
		return CustomImageAPISettings{}, fmt.Errorf("API Protocol 不支持")
	}
	stored := storedCustomImageAPISettings{BaseURL: baseURL, Model: model, Protocol: input.Protocol}
	raw, err := json.Marshal(stored)
	if err != nil {
		return CustomImageAPISettings{}, err
	}
	if err := service.appSettings.SetAppSetting(customImageAPISettingKey, string(raw)); err != nil {
		return CustomImageAPISettings{}, err
	}
	if apiKey := strings.TrimSpace(input.APIKey); apiKey != "" {
		if err := service.apiKeys.Set(coregeneration.ProviderWhereslowImage, apiKey); err != nil {
			return CustomImageAPISettings{}, err
		}
	}
	return service.GetCustomImageAPISettings(ctx)
}

// CustomImageAPIConfigured reports whether all custom image fields and the key are present.
func (service *Settings) CustomImageAPIConfigured(ctx context.Context) bool {
	settings, err := service.GetCustomImageAPISettings(ctx)
	return err == nil && settings.APIKey.Configured && settings.BaseURL != "" && settings.Model != ""
}
