package generation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	mediagoModelCatalogPath       = "/models/user"
	mediagoModelCatalogTimeout    = 3 * time.Second
	mediagoModelCatalogCacheTTL   = 30 * time.Second
	mediagoModelCatalogMaxBytes   = 1 << 20
	mediagoModelCatalogUserAgent  = "mediago-drama"
	mediagoModelCatalogAuthScheme = "Bearer "
)

type mediagoModelCatalogCache struct {
	mu        sync.Mutex
	key       string
	fetchedAt time.Time
	models    map[string]struct{}
	err       error
}

func (cache *mediagoModelCatalogCache) Clear() {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	cache.key = ""
	cache.fetchedAt = time.Time{}
	cache.models = nil
	cache.err = nil
}

func (cache *mediagoModelCatalogCache) Get(key string, now time.Time) (map[string]struct{}, bool, error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if cache.key != key || cache.fetchedAt.IsZero() || now.Sub(cache.fetchedAt) > mediagoModelCatalogCacheTTL {
		return nil, false, nil
	}
	return cloneMediagoModelSet(cache.models), true, cache.err
}

func (cache *mediagoModelCatalogCache) Set(key string, now time.Time, models map[string]struct{}, err error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	cache.key = key
	cache.fetchedAt = now
	cache.models = cloneMediagoModelSet(models)
	cache.err = err
}

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
	models, err := workflow.mediagoAvailableModels(ctx, apiKey)
	if err != nil {
		return false
	}
	_, ok := models[model]
	return ok
}

func (workflow *GenerationService) mediagoAvailableModels(ctx context.Context, apiKey string) (map[string]struct{}, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(workflow.mediagoBaseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" {
		return nil, fmt.Errorf("mediago generation base URL is not configured")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("mediago API key is not configured")
	}

	cacheKey := mediagoModelCatalogCacheKey(baseURL, apiKey)
	now := time.Now()
	if models, ok, err := workflow.mediagoModelCatalog.Get(cacheKey, now); ok {
		return models, err
	}

	models, err := fetchMediagoAvailableModels(ctx, http.DefaultClient, baseURL, apiKey)
	workflow.mediagoModelCatalog.Set(cacheKey, now, models, err)
	return models, err
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
		for _, id := range []string{item.ID, item.CanonicalSlug} {
			id = strings.TrimSpace(id)
			if id != "" {
				models[id] = struct{}{}
			}
		}
	}
	return models
}

func mediagoModelCatalogCacheKey(baseURL string, apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return strings.TrimRight(strings.TrimSpace(baseURL), "/") + "\x00" + hex.EncodeToString(sum[:])
}

func cloneMediagoModelSet(models map[string]struct{}) map[string]struct{} {
	if models == nil {
		return nil
	}
	clone := make(map[string]struct{}, len(models))
	for model := range models {
		clone[model] = struct{}{}
	}
	return clone
}
