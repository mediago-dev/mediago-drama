package mediago

import "strings"

const Provider = "mediago"

// SuppressOpenAIProviderOptions reports whether OpenAI-specific provider options
// should be omitted for a provider routed through the OpenRouter-compatible adapter.
func SuppressOpenAIProviderOptions(providerName string) bool {
	return providerName == Provider
}

// OmitChatImageSize reports whether image_size should be omitted from chat image
// requests for a MediaGo-routed upstream model.
func OmitChatImageSize(providerName string, model string) bool {
	if providerName != Provider {
		return false
	}
	normalized := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(normalized, "gemini-2.5-flash-image")
}
