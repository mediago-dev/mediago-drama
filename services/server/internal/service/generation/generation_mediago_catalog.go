package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	mediagoModelCatalogPath       = "/models/user"
	mediagoModelCatalogTimeout    = 10 * time.Second
	mediagoModelCatalogCacheTTL   = time.Minute
	mediagoModelCatalogFailureTTL = 15 * time.Second
	mediagoModelCatalogMaxBytes   = 1 << 20
	mediagoModelCatalogUserAgent  = "mediago-drama"
	mediagoModelCatalogAuthScheme = "Bearer "
)

// mediagoModelCatalogCache holds the last MediaGo user-catalog fetch so callers
// don't hit the upstream endpoint on every list/generate request.
type mediagoModelCatalogCache struct {
	mu        sync.Mutex
	baseURL   string
	apiKey    string
	models    map[string]struct{}
	fetchedAt time.Time
	lastErr   error
	failedAt  time.Time
}

// mediagoAvailableModels returns the MediaGo models enabled for the configured API
// key. Successful fetches are cached for mediagoModelCatalogCacheTTL, failed fetches
// for mediagoModelCatalogFailureTTL, and when a refresh fails the last successful
// catalog keeps being served so transient upstream slowness does not flip enabled
// models to disabled.
func (workflow *GenerationService) mediagoAvailableModels(ctx context.Context) (map[string]struct{}, error) {
	if workflow == nil || workflow.settings == nil {
		return nil, fmt.Errorf("generation settings are unavailable")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(workflow.mediagoBaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("mediago generation base URL is not configured")
	}
	apiKey, _, err := workflow.settings.GetAPIKey(ctx, coregeneration.ProviderMediago)
	if err != nil {
		return nil, fmt.Errorf("loading mediago API key: %w", err)
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, fmt.Errorf("mediago API key is not configured")
	}

	cache := &workflow.mediagoModelCatalog
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.baseURL != baseURL || cache.apiKey != apiKey {
		cache.baseURL = baseURL
		cache.apiKey = apiKey
		cache.models = nil
		cache.fetchedAt = time.Time{}
		cache.lastErr = nil
		cache.failedAt = time.Time{}
	}
	if cache.models != nil && time.Since(cache.fetchedAt) < mediagoModelCatalogCacheTTL {
		return cache.models, nil
	}
	if !cache.failedAt.IsZero() && time.Since(cache.failedAt) < mediagoModelCatalogFailureTTL {
		if cache.models != nil {
			return cache.models, nil
		}
		return nil, cache.lastErr
	}

	models, err := fetchMediagoAvailableModels(ctx, http.DefaultClient, baseURL, apiKey)
	if err != nil {
		cache.lastErr = err
		cache.failedAt = time.Now()
		if cache.models != nil {
			slog.Warn(
				"mediago model catalog refresh failed; serving cached catalog",
				"error", err,
				"cache_age", time.Since(cache.fetchedAt).Round(time.Second).String(),
			)
			return cache.models, nil
		}
		slog.Warn("mediago model catalog fetch failed", "error", err)
		return nil, err
	}
	cache.models = models
	cache.fetchedAt = time.Now()
	cache.lastErr = nil
	cache.failedAt = time.Time{}
	return models, nil
}

// mediagoAvailableModelsForCatalog resolves the MediaGo user catalog for model
// listings. The boolean reports whether the result should be used to filter
// MediaGo routes; a nil set with true hides them all (no key or catalog
// unavailable with nothing cached).
func (workflow *GenerationService) mediagoAvailableModelsForCatalog(ctx context.Context) (map[string]struct{}, bool) {
	if workflow == nil || workflow.settings == nil {
		return nil, false
	}
	if strings.TrimSpace(workflow.mediagoBaseURL) == "" {
		return nil, true
	}
	models, err := workflow.mediagoAvailableModels(ctx)
	if err != nil {
		return nil, true
	}
	return models, true
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
