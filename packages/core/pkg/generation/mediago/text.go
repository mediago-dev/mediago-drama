package mediago

import "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

const (
	RouteGPT41MiniText           = "mediago.gpt-4.1-mini-text"
	RouteGPT5MiniText            = "mediago.gpt-5-mini-text"
	RouteGPT55Text               = "mediago.gpt-5.5-text"
	RouteGPT54Text               = "mediago.gpt-5.4-text"
	RouteGPT54MiniText           = "mediago.gpt-5.4-mini-text"
	RouteGemini35FlashText       = "mediago.gemini-3.5-flash-text"
	RouteGemini31ProText         = "mediago.gemini-3.1-pro-preview-text"
	RouteGemini31FlashLiteText   = "mediago.gemini-3.1-flash-lite-text"
	RouteMiniMaxM3Text           = "mediago.minimax-m3-text"
	RouteMiniMaxM27Text          = "mediago.minimax-m2.7-text"
	RouteMiniMaxM27HighspeedText = "mediago.minimax-m2.7-highspeed-text"
	RouteDeepSeekV4FlashText     = "mediago.deepseek-v4-flash-text"
	RouteDeepSeekV4ProText       = "mediago.deepseek-v4-pro-text"

	versionGPT41MiniText           = "gpt-4.1-mini-text"
	versionGPT5MiniText            = "gpt-5-mini-text"
	versionGPT55Text               = "gpt-5.5-text"
	versionGPT54Text               = "gpt-5.4-text"
	versionGPT54MiniText           = "gpt-5.4-mini-text"
	versionGemini35FlashText       = "gemini-3.5-flash-text"
	versionGemini31ProText         = "gemini-3.1-pro-preview-text"
	versionGemini31FlashLiteText   = "gemini-3.1-flash-lite-text"
	versionMiniMaxM3Text           = "minimax-m3-text"
	versionMiniMaxM27Text          = "minimax-m2.7-text"
	versionMiniMaxM27HighspeedText = "minimax-m2.7-highspeed-text"
	versionDeepSeekV4FlashText     = "deepseek-v4-flash-text"
	versionDeepSeekV4ProText       = "deepseek-v4-pro-text"
)

func textRoutes() []catalog.RouteSpec {
	return []catalog.RouteSpec{
		textRoute(RouteGPT41MiniText, familyGPTText, versionGPT41MiniText, "gpt-4.1-mini"),
		textRoute(RouteGPT5MiniText, familyGPTText, versionGPT5MiniText, "gpt-5-mini"),
		textRoute(RouteGPT55Text, familyGPTText, versionGPT55Text, "gpt-5.5"),
		textRoute(RouteGPT54Text, familyGPTText, versionGPT54Text, "gpt-5.4"),
		textRoute(RouteGPT54MiniText, familyGPTText, versionGPT54MiniText, "gpt-5.4-mini"),
		textRoute(RouteGemini35FlashText, familyGeminiText, versionGemini35FlashText, "gemini-3.5-flash"),
		textRoute(RouteGemini31ProText, familyGeminiText, versionGemini31ProText, "gemini-3.1-pro-preview"),
		textRoute(RouteGemini31FlashLiteText, familyGeminiText, versionGemini31FlashLiteText, "gemini-3.1-flash-lite"),
		textRoute(RouteMiniMaxM3Text, familyMiniMaxText, versionMiniMaxM3Text, "MiniMax-M3"),
		textRoute(RouteMiniMaxM27Text, familyMiniMaxText, versionMiniMaxM27Text, "MiniMax-M2.7"),
		textRoute(RouteMiniMaxM27HighspeedText, familyMiniMaxText, versionMiniMaxM27HighspeedText, "MiniMax-M2.7-highspeed"),
		textRoute(RouteDeepSeekV4FlashText, familyDeepSeekText, versionDeepSeekV4FlashText, "deepseek-v4-flash"),
		textRoute(RouteDeepSeekV4ProText, familyDeepSeekText, versionDeepSeekV4ProText, "deepseek-v4-pro"),
	}
}

func textRoute(routeID string, familyID string, versionID string, model string) catalog.RouteSpec {
	return catalog.RouteSpec{
		ID:        routeID,
		FamilyID:  familyID,
		VersionID: versionID,
		Kind:      kindText,
		Label:     "MediaGo",
		Model:     model,
		Adapter:   adapterOpenRouterChatText,
		DocURL:    openRouterChatDocs,
		Params:    textParams(),
	}
}

func textParams() catalog.ParamConfig {
	return catalog.IdentityParamConfig([]catalog.RouteParam{
		catalog.NumberParam(catalog.ParamTemperature, 0.7, 0, 2),
		catalog.OptionalNumberParam(catalog.ParamMaxTokens, 1, 32768),
	})
}
