package mediago

import "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

const (
	familySeedream     = "seedream"
	familyGPTText      = "gpt-text"
	familyGeminiText   = "gemini-text"
	familyMiniMaxText  = "minimax-text"
	familyDeepSeekText = "deepseek-text"
	familyGPTImage     = "gpt-image"
	familyNanoBanana   = "nano-banana"

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
	routes := []catalog.RouteSpec{}
	routes = append(routes, imageRoutes()...)
	routes = append(routes, textRoutes()...)
	routes = append(routes, gptImageRoutes()...)
	routes = append(routes, geminiImageRoutes()...)
	return routes
}
