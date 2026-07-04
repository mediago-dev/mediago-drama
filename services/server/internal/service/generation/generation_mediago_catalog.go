package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	mediagoModelCatalogPath       = "/models/user"
	mediagoModelCatalogTimeout    = 3 * time.Second
	mediagoModelCatalogMaxBytes   = 1 << 20
	mediagoModelCatalogUserAgent  = "mediago-drama"
	mediagoModelCatalogAuthScheme = "Bearer "
)

func (workflow *GenerationService) mediagoRouteModelAvailable(ctx context.Context, route coregeneration.ModelRoute) bool {
	if workflow == nil {
		return false
	}
	model := strings.TrimSpace(route.Model)
	if model == "" {
		return false
	}
	apiKey, _, err := workflow.settings.GetAPIKey(ctx, coregeneration.ProviderMediago)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		return false
	}
	models, err := workflow.mediagoAvailableModelsFresh(ctx, apiKey)
	if err != nil {
		return false
	}
	_, ok := models[model]
	return ok
}

func (workflow *GenerationService) mediagoAvailableModelsForCatalog(ctx context.Context) (map[string]struct{}, bool) {
	if workflow == nil || workflow.settings == nil {
		return nil, false
	}
	if strings.TrimSpace(workflow.mediagoBaseURL) == "" {
		return nil, true
	}
	apiKey, _, err := workflow.settings.GetAPIKey(ctx, coregeneration.ProviderMediago)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		return nil, true
	}
	models, err := workflow.mediagoAvailableModelsFresh(ctx, apiKey)
	if err != nil {
		return nil, true
	}
	return models, true
}

func (workflow *GenerationService) mediagoAvailableModelsFresh(ctx context.Context, apiKey string) (map[string]struct{}, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(workflow.mediagoBaseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" {
		return nil, fmt.Errorf("mediago generation base URL is not configured")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("mediago API key is not configured")
	}
	return fetchMediagoAvailableModels(ctx, http.DefaultClient, baseURL, apiKey)
}

func fetchMediagoAvailableModels(ctx context.Context, client *http.Client, baseURL string, apiKey string) (map[string]struct{}, error) {
	if client == nil {
		client = http.DefaultClient
	}
	requestCtx, cancel := context.WithTimeout(ctx, mediagoModelCatalogTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, baseURL+mediagoModelCatalogPath, nil)
	if err != nil {
		return nil, fmt.Errorf("creating mediago model catalog request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", mediagoModelCatalogAuthScheme+apiKey)
	request.Header.Set("User-Agent", mediagoModelCatalogUserAgent)

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetching mediago model catalog: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, mediagoModelCatalogMaxBytes))
	if err != nil {
		return nil, fmt.Errorf("reading mediago model catalog: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("mediago model catalog failed with status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	models, err := parseMediagoAvailableModels(body)
	if err != nil {
		return nil, err
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("mediago model catalog returned no models")
	}
	return models, nil
}

type mediagoModelCatalogResponse struct {
	Data []mediagoModelCatalogItem `json:"data"`
}

type mediagoModelCatalogItem struct {
	ID            string `json:"id"`
	CanonicalSlug string `json:"canonical_slug"`
	Enabled       *bool  `json:"enabled,omitempty"`
	Disabled      *bool  `json:"disabled,omitempty"`
	Available     *bool  `json:"available,omitempty"`
	Hidden        *bool  `json:"hidden,omitempty"`
	Visible       *bool  `json:"visible,omitempty"`
	Status        string `json:"status,omitempty"`
	RouteStatus   string `json:"route_status,omitempty"`
	ChannelStatus string `json:"channel_status,omitempty"`
	ModelStatus   string `json:"model_status,omitempty"`
	State         string `json:"state,omitempty"`
}

func parseMediagoAvailableModels(body []byte) (map[string]struct{}, error) {
	var wrapped mediagoModelCatalogResponse
	if err := json.Unmarshal(body, &wrapped); err == nil && wrapped.Data != nil {
		return mediagoModelSetFromItems(wrapped.Data), nil
	}

	var direct []mediagoModelCatalogItem
	if err := json.Unmarshal(body, &direct); err == nil {
		return mediagoModelSetFromItems(direct), nil
	}

	return nil, fmt.Errorf("decoding mediago model catalog")
}

func mediagoModelSetFromItems(items []mediagoModelCatalogItem) map[string]struct{} {
	models := make(map[string]struct{}, len(items))
	for _, item := range items {
		if !mediagoModelCatalogItemAvailable(item) {
			continue
		}
		for _, id := range []string{item.ID, item.CanonicalSlug} {
			id = strings.TrimSpace(id)
			if id != "" {
				models[id] = struct{}{}
			}
		}
	}
	return models
}

func mediagoModelCatalogItemAvailable(item mediagoModelCatalogItem) bool {
	if item.Disabled != nil && *item.Disabled {
		return false
	}
	if item.Hidden != nil && *item.Hidden {
		return false
	}
	if item.Enabled != nil && !*item.Enabled {
		return false
	}
	if item.Available != nil && !*item.Available {
		return false
	}
	if item.Visible != nil && !*item.Visible {
		return false
	}
	for _, status := range []string{item.Status, item.RouteStatus, item.ChannelStatus, item.ModelStatus, item.State} {
		if mediagoModelUnavailableStatus(status) {
			return false
		}
	}
	return true
}

func mediagoModelUnavailableStatus(status string) bool {
	normalized := strings.ToLower(strings.TrimSpace(status))
	if normalized == "" {
		return false
	}
	normalized = strings.NewReplacer("_", " ", "-", " ").Replace(normalized)
	for _, token := range []string{
		"disabled",
		"disable",
		"unavailable",
		"inactive",
		"hidden",
		"offline",
		"closed",
		"deleted",
		"removed",
		"blocked",
		"停用",
		"禁用",
		"隐藏",
		"不可用",
		"关闭",
		"下架",
	} {
		if strings.Contains(normalized, token) {
			return true
		}
	}
	return false
}

func mediagoModelSetHasRoute(models map[string]struct{}, route coregeneration.ModelRoute) bool {
	model := strings.TrimSpace(route.Model)
	if model == "" {
		return false
	}
	_, ok := models[model]
	return ok
}
