// Package openrouter adapts OpenRouter media generation endpoints.
package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

const (
	defaultBaseURL    = "https://openrouter.ai/api/v1"
	defaultHTTPClient = 1000 * time.Second
)

// Config controls the OpenRouter provider.
type Config struct {
	BaseURL    string
	APIKey     string
	AppURL     string
	AppTitle   string
	HTTPClient *http.Client
}

// Provider calls OpenRouter image and video generation endpoints.
type Provider struct {
	baseURL  string
	apiKey   string
	appURL   string
	appTitle string
	client   *http.Client
}

// NewProvider creates an OpenRouter generation provider.
func NewProvider(config Config) (*Provider, error) {
	if config.APIKey == "" {
		return nil, generation.ErrMissingAPIKey
	}

	baseURL := strings.TrimRight(config.BaseURL, "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultHTTPClient}
	}

	return &Provider{
		baseURL:  baseURL,
		apiKey:   config.APIKey,
		appURL:   config.AppURL,
		appTitle: config.AppTitle,
		client:   client,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return generation.ProviderOpenRouter
}

// Generate dispatches OpenRouter image or video generation.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}

	adapter, err := provider.resolveRequest(&request)
	if err != nil {
		return generation.Response{}, err
	}

	switch request.Kind {
	case generation.KindImage:
		if adapter == generation.AdapterOpenRouterImages {
			return provider.generateImages(ctx, request)
		}
		return provider.generateImage(ctx, request)
	case generation.KindVideo:
		return provider.createVideo(ctx, request)
	case generation.KindText:
		return provider.generateText(ctx, request)
	default:
		return generation.Response{}, fmt.Errorf("%q: %w", request.Kind, generation.ErrUnsupportedKind)
	}
}

func (provider *Provider) resolveRequest(request *generation.Request) (string, error) {
	if request.RouteID == "" && request.ModelID == "" && request.Model != "" {
		if request.Kind == "" {
			request.Kind = generation.KindImage
		}
		return "", nil
	}

	route, err := generation.ResolveRoute(generation.RouteQuery{
		Kind:     request.Kind,
		RouteID:  request.RouteID,
		ModelID:  request.ModelID,
		Provider: generation.ProviderOpenRouter,
	})
	if err != nil {
		return "", err
	}
	if err := generation.ValidateRequestForRoute(*request, route); err != nil {
		return "", err
	}
	*request = generation.ApplyRoute(*request, route)
	return route.Adapter, nil
}

func (provider *Provider) postJSON(ctx context.Context, endpoint string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	provider.setHeaders(request)

	return provider.doJSON(request, result)
}

func (provider *Provider) postStream(ctx context.Context, endpoint string, payload any) (io.ReadCloser, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	provider.setHeaders(request)

	response, err := provider.client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		return nil, provider.readHTTPError(response)
	}

	return response.Body, nil
}

func (provider *Provider) getJSON(ctx context.Context, endpoint string, result any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, provider.baseURL+endpoint, nil)
	if err != nil {
		return err
	}
	provider.setHeaders(request)

	return provider.doJSON(request, result)
}

func (provider *Provider) setHeaders(request *http.Request) {
	request.Header.Set("Authorization", "Bearer "+strings.TrimPrefix(provider.apiKey, "Bearer "))
	if provider.appURL != "" {
		request.Header.Set("HTTP-Referer", provider.appURL)
	}
	if provider.appTitle != "" {
		request.Header.Set("X-Title", provider.appTitle)
	}
}

func (provider *Provider) doJSON(request *http.Request, result any) error {
	response, err := provider.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return provider.readHTTPError(response)
	}

	return json.NewDecoder(response.Body).Decode(result)
}

func taskIDPrefix(request generation.Request) string {
	if request.RouteID != "" {
		return request.RouteID
	}

	return request.ModelID
}

func valueOrDefault(value string, fallback string) string {
	return adapterutil.ValueOrDefault(value, fallback)
}

func firstNonEmpty(values ...string) string {
	return adapterutil.FirstNonEmpty(values...)
}

func joinTaskID(prefix string, taskID string) string {
	return adapterutil.JoinTaskID(prefix, taskID)
}

func splitTaskID(id string) (string, string) {
	return adapterutil.SplitTaskID(id)
}

func paramString(params map[string]any, key string) string {
	return adapterutil.ParamString(params, key)
}

func paramInt(params map[string]any, key string, fallback int) int {
	return adapterutil.ParamInt(params, key, fallback)
}

func paramIntPointer(params map[string]any, key string) *int {
	return adapterutil.ParamIntPointer(params, key)
}

func paramBoolValue(params map[string]any, key string) (bool, bool) {
	return adapterutil.ParamBoolValueOnly(params, key)
}

func normalizeVideoStatus(status string) string {
	return adapterutil.NormalizeVideoStatus(status)
}

func (provider *Provider) readHTTPError(response *http.Response) error {
	return generation.HTTPErrorFromResponse(generation.ProviderOpenRouter, response)
}
