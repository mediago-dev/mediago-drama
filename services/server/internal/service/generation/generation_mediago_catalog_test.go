package generation

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestListGenerationModelsRequiresBothMediagoHappyHorseModes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"id":"happyhorse-1.1-t2v"}]}`))
	}))
	defer server.Close()

	settingsSvc := newGenerationTestSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderMediago: "mgak-test"},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.SetMediagoBaseURL(server.URL)

	if generationRouteConfiguredInCatalog(workflow.ListGenerationModels(), coregeneration.RouteMediagoHappyHorse11) {
		t.Fatal("MediaGo HappyHorse route should stay hidden until t2v and r2v are both available")
	}
	route, ok := coregeneration.FindRoute(coregeneration.RouteMediagoHappyHorse11)
	if !ok {
		t.Fatalf("missing route %q", coregeneration.RouteMediagoHappyHorse11)
	}
	_, err := workflow.newGenerationProvider(route)
	if err == nil || !strings.Contains(err.Error(), "happyhorse-1.1-r2v") {
		t.Fatalf("newGenerationProvider() error = %v, want missing r2v model", err)
	}
}

func generationRouteConfiguredInCatalog(catalog GenerationModelsResponse, routeID string) bool {
	for _, route := range catalog.Routes {
		if route.ID == routeID {
			return route.Configured
		}
	}
	return false
}
