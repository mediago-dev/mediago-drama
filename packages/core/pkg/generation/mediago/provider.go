// Package mediago adapts MediaGo Gateway generation endpoints to core contracts.
package mediago

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
	defaultHTTPTimeout = 1000 * time.Second
)

// Config controls the MediaGo provider.
type Config struct {
	BaseURL    string
	APIKey     string
	AppURL     string
	AppTitle   string
	HTTPClient *http.Client
}

// Provider calls MediaGo generation endpoints.
type Provider struct {
	baseURL  string
	apiKey   string
	appURL   string
	appTitle string
	client   *http.Client
}

// NewProvider creates a MediaGo generation provider.
func NewProvider(config Config) (*Provider, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("mediago generation base URL is required")
	}
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, generation.ErrMissingAPIKey
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultHTTPTimeout}
	}
	return &Provider{
		baseURL:  baseURL,
		apiKey:   apiKey,
		appURL:   strings.TrimSpace(config.AppURL),
		appTitle: strings.TrimSpace(config.AppTitle),
		client:   client,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return generation.ProviderMediago
}

// Generate dispatches a MediaGo generation request.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}
	adapter, err := provider.resolveRequest(&request)
	if err != nil {
		return generation.Response{}, err
	}
	switch adapter {
	case generation.AdapterMediagoChatImage:
		return provider.generateChatImage(ctx, request)
	case generation.AdapterMediagoImages:
		return provider.generateImage(ctx, request)
	case generation.AdapterMediagoText:
		return provider.generateText(ctx, request)
	case generation.AdapterMediagoVideo:
		return provider.createVideo(ctx, request)
	default:
		return generation.Response{}, fmt.Errorf("unsupported MediaGo adapter %q", adapter)
	}
}

func (provider *Provider) resolveRequest(request *generation.Request) (string, error) {
	if request.RouteID == "" && request.ModelID == "" && request.Model != "" {
		switch request.Kind {
		case generation.KindText:
			return generation.AdapterMediagoText, nil
		case generation.KindVideo:
			return generation.AdapterMediagoVideo, nil
		case "", generation.KindImage:
			request.Kind = generation.KindImage
			return generation.AdapterMediagoChatImage, nil
		default:
			return "", fmt.Errorf("%q: %w", request.Kind, generation.ErrUnsupportedKind)
		}
	}

	route, err := generation.ResolveRoute(generation.RouteQuery{
		Kind:     request.Kind,
		RouteID:  request.RouteID,
		ModelID:  request.ModelID,
		Provider: generation.ProviderMediago,
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
	return provider.postJSONWithHeaders(ctx, endpoint, payload, nil, result)
}

func (provider *Provider) postJSONWithHeaders(
	ctx context.Context,
	endpoint string,
	payload any,
	headers map[string]string,
	result any,
) error {
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
	for name, value := range headers {
		request.Header.Set(name, value)
	}
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
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		defer response.Body.Close()
		return nil, generation.HTTPErrorFromResponse(generation.ProviderMediago, response)
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

func (provider *Provider) getJSONStatus(ctx context.Context, endpoint string, result any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, provider.baseURL+endpoint, nil)
	if err != nil {
		return 0, err
	}
	provider.setHeaders(request)
	response, err := provider.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK && result != nil {
		return response.StatusCode, json.NewDecoder(response.Body).Decode(result)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, nil
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
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return generation.HTTPErrorFromResponse(generation.ProviderMediago, response)
	}
	if result == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(result); err != nil {
		return err
	}
	return nil
}

func taskIDPrefix(request generation.Request) string {
	if request.RouteID != "" {
		return request.RouteID
	}
	return request.ModelID
}

func firstNonEmpty(values ...string) string {
	return adapterutil.FirstNonEmpty(values...)
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

func compactStrings(values []string) []string {
	return adapterutil.CompactStrings(values)
}
