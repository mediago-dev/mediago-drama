package generation

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestListGenerationModelsFiltersMediagoRoutesByUserCatalog(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		atomic.AddInt32(&requests, 1)
		if request.URL.Path != "/models/user" {
			http.NotFound(response, request)
			return
		}
		if request.Header.Get("Authorization") != "Bearer mgak-test" {
			http.Error(response, "missing bearer token", http.StatusUnauthorized)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{
				"data": [
					{"id": "gpt-image-2"},
					{"canonical_slug": "doubao-seedream-5-0-lite"},
					{"id": "gemini-3.1-flash-image"}
				]
			}`))
	}))
	defer server.Close()

	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderMediago: "mgak-test"},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.SetMediagoBaseURL(server.URL)

	catalog := workflow.ListGenerationModels()

	if !generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoGPTImage2) {
		t.Fatalf("route %q should be configured when present in MediaGo user catalog", coregeneration.RouteMediagoGPTImage2)
	}
	if !generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoSeedream5Lite) {
		t.Fatalf("route %q should be configured by canonical_slug in MediaGo user catalog", coregeneration.RouteMediagoSeedream5Lite)
	}
	if !generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoNanoBanana31) {
		t.Fatalf("route %q should be configured when present in MediaGo user catalog", coregeneration.RouteMediagoNanoBanana31)
	}
	if generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoNanoBanana25) {
		t.Fatalf("route %q should be hidden when absent from MediaGo user catalog", coregeneration.RouteMediagoNanoBanana25)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("MediaGo model catalog requests = %d, want 1 cached request", got)
	}
}

func TestListGenerationModelsHidesMediagoRoutesWhenUserCatalogUnavailable(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		atomic.AddInt32(&requests, 1)
		http.Error(response, "gateway unavailable", http.StatusBadGateway)
	}))
	defer server.Close()

	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderMediago: "mgak-test"},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.SetMediagoBaseURL(server.URL)

	catalog := workflow.ListGenerationModels()

	if generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoGPTImage2) {
		t.Fatalf("route %q should be hidden when MediaGo user catalog is unavailable", coregeneration.RouteMediagoGPTImage2)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("MediaGo model catalog requests = %d, want 1 cached failed request", got)
	}
}

func TestListGenerationModelsHidesDisabledMediagoUserCatalogItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{
				"data": [
					{"id": "gpt-image-2", "enabled": true},
					{"id": "gemini-2.5-flash-image", "enabled": false},
					{"canonical_slug": "doubao-seedream-5-0-lite", "disabled": true},
					{"id": "MiniMax-M3", "route_status": "disabled"}
				]
			}`))
	}))
	defer server.Close()

	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderMediago: "mgak-test"},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.SetMediagoBaseURL(server.URL)

	catalog := workflow.ListGenerationModels()

	if !generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoGPTImage2) {
		t.Fatalf("route %q should be configured when enabled in MediaGo user catalog", coregeneration.RouteMediagoGPTImage2)
	}
	if generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoNanoBanana25) {
		t.Fatalf("route %q should be hidden when disabled in MediaGo user catalog", coregeneration.RouteMediagoNanoBanana25)
	}
	if generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoSeedream5Lite) {
		t.Fatalf("route %q should be hidden when disabled by canonical_slug in MediaGo user catalog", coregeneration.RouteMediagoSeedream5Lite)
	}
	if generationRouteConfiguredInCatalog(catalog, coregeneration.RouteMediagoMiniMaxM3Text) {
		t.Fatalf("route %q should be hidden when route_status is disabled in MediaGo user catalog", coregeneration.RouteMediagoMiniMaxM3Text)
	}
}

func TestMediagoRouteUnavailableReportsInactiveModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"id":"gpt-image-2"}]}`))
	}))
	defer server.Close()

	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderMediago: "mgak-test"},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.SetMediagoBaseURL(server.URL)

	route, ok := coregeneration.FindRoute(coregeneration.RouteMediagoNanoBanana25)
	if !ok {
		t.Fatalf("missing route %q", coregeneration.RouteMediagoNanoBanana25)
	}
	_, err := workflow.newGenerationProvider(route)
	if err == nil || !strings.Contains(err.Error(), "MediaGo 聚合平台当前未启用模型 gemini-2.5-flash-image") {
		t.Fatalf("newGenerationProvider() error = %v, want inactive MediaGo model", err)
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
