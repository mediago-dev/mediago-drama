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
	RouteSeedream5Lite           = "mediago.seedream-5-lite"
	RouteGPTImage2               = "mediago.gpt-image-2"
	RouteNanoBanana31            = "mediago.gemini-3.1-flash-image"
	RouteNanoBananaPro           = "mediago.gemini-3-pro-image"
	RouteNanoBanana25            = "mediago.gemini-2.5-flash-image"
)

const (
	familySeedream     = "seedream"
	familyGPTText      = "gpt-text"
	familyGeminiText   = "gemini-text"
	familyMiniMaxText  = "minimax-text"
	familyDeepSeekText = "deepseek-text"
	familyGPTImage     = "gpt-image"
	familyNanoBanana   = "nano-banana"

	versionSeedream5Lite           = "seedream-5-lite"
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
	versionGPTImage2               = "gpt-image-2"
	versionNanoBanana31            = "gemini-3.1-flash-image-preview"
	versionNanoBananaPro           = "gemini-3-pro-image-preview"
	versionNanoBanana25            = "gemini-2.5-flash-image"

	kindText  = "text"
	kindImage = "image"

	adapterOpenRouterImages    = "openrouter.images"
	adapterOpenRouterChatImage = "openrouter.chat.image"
	adapterOpenRouterChatText  = "openrouter.chat.text"

	openRouterChatDocs  = "https://openrouter.ai/docs/api-reference/chat-completion"
	openRouterImageDocs = "https://openrouter.ai/docs/guides/overview/multimodal/image-generation"
)

// RoutesForFamily returns the MediaGo aggregation routes for one model family.
func RoutesForFamily(familyID string) []catalog.RouteSpec {
	routes := allRoutes()
	result := make([]catalog.RouteSpec, 0, len(routes))
	for _, route := range routes {
		if route.FamilyID == familyID {
			result = append(result, route)
		}
	}
	return result
}

func allRoutes() []catalog.RouteSpec {
	return []catalog.RouteSpec{
		{
			ID:                    RouteSeedream5Lite,
			FamilyID:              familySeedream,
			VersionID:             versionSeedream5Lite,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "doubao-seedream-5-0-lite",
			Adapter:               adapterOpenRouterChatImage,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: false,
			Params:                chatImageParams(),
		},
		{
			ID:        RouteGPT41MiniText,
			FamilyID:  familyGPTText,
			VersionID: versionGPT41MiniText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gpt-4.1-mini",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGPT5MiniText,
			FamilyID:  familyGPTText,
			VersionID: versionGPT5MiniText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gpt-5-mini",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGPT55Text,
			FamilyID:  familyGPTText,
			VersionID: versionGPT55Text,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gpt-5.5",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGPT54Text,
			FamilyID:  familyGPTText,
			VersionID: versionGPT54Text,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gpt-5.4",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGPT54MiniText,
			FamilyID:  familyGPTText,
			VersionID: versionGPT54MiniText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gpt-5.4-mini",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGemini35FlashText,
			FamilyID:  familyGeminiText,
			VersionID: versionGemini35FlashText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gemini-3.5-flash",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGemini31ProText,
			FamilyID:  familyGeminiText,
			VersionID: versionGemini31ProText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gemini-3.1-pro-preview",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteGemini31FlashLiteText,
			FamilyID:  familyGeminiText,
			VersionID: versionGemini31FlashLiteText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "gemini-3.1-flash-lite",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteMiniMaxM3Text,
			FamilyID:  familyMiniMaxText,
			VersionID: versionMiniMaxM3Text,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "MiniMax-M3",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteMiniMaxM27Text,
			FamilyID:  familyMiniMaxText,
			VersionID: versionMiniMaxM27Text,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "MiniMax-M2.7",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteMiniMaxM27HighspeedText,
			FamilyID:  familyMiniMaxText,
			VersionID: versionMiniMaxM27HighspeedText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "MiniMax-M2.7-highspeed",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteDeepSeekV4FlashText,
			FamilyID:  familyDeepSeekText,
			VersionID: versionDeepSeekV4FlashText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "deepseek-v4-flash",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:        RouteDeepSeekV4ProText,
			FamilyID:  familyDeepSeekText,
			VersionID: versionDeepSeekV4ProText,
			Kind:      kindText,
			Label:     "MediaGo",
			Model:     "deepseek-v4-pro",
			Adapter:   adapterOpenRouterChatText,
			DocURL:    openRouterChatDocs,
			Params:    textParams(),
		},
		{
			ID:                    RouteGPTImage2,
			FamilyID:              familyGPTImage,
			VersionID:             versionGPTImage2,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "gpt-image-2",
			Adapter:               adapterOpenRouterImages,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: true,
			Params:                gptImageParams(),
		},
		{
			ID:                    RouteNanoBanana31,
			FamilyID:              familyNanoBanana,
			VersionID:             versionNanoBanana31,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "gemini-3.1-flash-image",
			Adapter:               adapterOpenRouterChatImage,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: true,
			Params:                nanoBanana31Params(),
		},
		{
			ID:                    RouteNanoBananaPro,
			FamilyID:              familyNanoBanana,
			VersionID:             versionNanoBananaPro,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "gemini-3-pro-image",
			Adapter:               adapterOpenRouterChatImage,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: true,
			Params:                nanoBananaProParams(),
		},
		{
			ID:                    RouteNanoBanana25,
			FamilyID:              familyNanoBanana,
			VersionID:             versionNanoBanana25,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "gemini-2.5-flash-image",
			Adapter:               adapterOpenRouterChatImage,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: true,
			Params:                nanoBanana25Params(),
		},
	}
}
