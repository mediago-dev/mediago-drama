package generation

import (
	"strings"
	"testing"
)

func TestCurrentImageCatalogOnlyExposesCustomGeminiRoute(t *testing.T) {
	var imageRoutes []ModelRoute
	for _, route := range Routes() {
		if route.Kind == KindImage {
			imageRoutes = append(imageRoutes, route)
		}
	}
	if len(imageRoutes) != 1 || imageRoutes[0].ID != RouteWhereslowNanoBanana2 {
		t.Fatalf("image routes = %#v, want only %q", imageRoutes, RouteWhereslowNanoBanana2)
	}
	route := imageRoutes[0]
	if route.Provider != ProviderWhereslowImage || route.Adapter != AdapterWhereslowImage {
		t.Fatalf("image route provider/adapter = %q/%q", route.Provider, route.Adapter)
	}
	if !route.SupportsReferenceURLs || route.MaxReferenceURLs != 4 {
		t.Fatalf("image route reference support = %v/%d", route.SupportsReferenceURLs, route.MaxReferenceURLs)
	}
}

func TestCurrentImageRouteValidationAndDefaults(t *testing.T) {
	route := mustRoute(t, RouteWhereslowNanoBanana2)
	assertHasParams(t, route, "aspectRatio", "resolution", "n")
	assertParamDefault(t, route, "resolution", "1K")
	assertParamDefault(t, route, "n", float64(1))

	err := ValidateRequestForRoute(Request{Kind: KindImage, ReferenceURLs: []string{"1", "2", "3", "4", "5"}}, route)
	if err == nil || !strings.Contains(err.Error(), "supports at most 4 reference URLs") {
		t.Fatalf("reference limit error = %v", err)
	}

	resolved, err := ResolveRoute(RouteQuery{RouteID: RouteWhereslowNanoBanana2, Kind: KindImage})
	if err != nil || resolved.ID != RouteWhereslowNanoBanana2 {
		t.Fatalf("ResolveRoute() = %#v, %v", resolved, err)
	}
}
