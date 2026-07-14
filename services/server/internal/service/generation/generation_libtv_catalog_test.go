package generation

import (
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestListGenerationModelsIncludesLibTVImageRoutes(t *testing.T) {
	routeIDs := []string{
		coregeneration.RouteLibTVGPTImage2,
		coregeneration.RouteLibTVNanoBanana31,
		coregeneration.RouteLibTVSeedream5Lite,
	}

	keyStore := &generationTestAPIKeyStore{values: map[string]string{}}
	workflow := NewGenerationService(settings.NewSettings(keyStore), nil, nil)

	assertLibTVImageCatalogRoutes(t, workflow.ListGenerationModels(), routeIDs, false)

	keyStore.values[coregeneration.ProviderLibTV] = "oauth:2026-07-14T00:00:00Z"
	assertLibTVImageCatalogRoutes(t, workflow.ListGenerationModels(), routeIDs, true)
}

func assertLibTVImageCatalogRoutes(
	t *testing.T,
	catalog GenerationModelsResponse,
	routeIDs []string,
	wantConfigured bool,
) {
	t.Helper()

	routesByID := make(map[string]coregeneration.ModelRoute, len(catalog.Routes))
	for _, route := range catalog.Routes {
		routesByID[route.ID] = route
	}
	for _, routeID := range routeIDs {
		route, ok := routesByID[routeID]
		if !ok {
			t.Errorf("route %q is missing from the generation catalog", routeID)
			continue
		}
		if route.Kind != coregeneration.KindImage || route.Provider != coregeneration.ProviderLibTV {
			t.Errorf("route %q = kind %q provider %q, want LibTV image", routeID, route.Kind, route.Provider)
		}
		if route.Async {
			t.Errorf("route %q async = true, want server-managed background image execution", routeID)
		}
		if route.Configured != wantConfigured {
			t.Errorf("route %q configured = %v, want %v", routeID, route.Configured, wantConfigured)
		}
	}
}
