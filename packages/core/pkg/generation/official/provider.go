// Package official adapts first-party media generation APIs.
package official

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
	defaultOpenAIBaseURL     = "https://api.openai.com"
	defaultGoogleBaseURL     = "https://generativelanguage.googleapis.com"
	defaultVolcengineBaseURL = "https://ark.cn-beijing.volces.com/api/v3"
	defaultHTTPClient        = 90 * time.Second
)

// Config controls first-party provider endpoints.
type Config struct {
	APIKey            string
	OpenAIBaseURL     string
	GoogleBaseURL     string
	VolcengineBaseURL string
	HTTPClient        *http.Client
}

// Provider calls first-party image and video generation APIs.
type Provider struct {
	apiKey            string
	openAIBaseURL     string
	googleBaseURL     string
	volcengineBaseURL string
	client            *http.Client
}

// NewProvider creates a first-party generation provider.
func NewProvider(config Config) (*Provider, error) {
	if config.APIKey == "" {
		return nil, generation.ErrMissingAPIKey
	}

	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultHTTPClient}
	}

	return &Provider{
		apiKey:            config.APIKey,
		openAIBaseURL:     valueOrDefault(strings.TrimRight(config.OpenAIBaseURL, "/"), defaultOpenAIBaseURL),
		googleBaseURL:     valueOrDefault(strings.TrimRight(config.GoogleBaseURL, "/"), defaultGoogleBaseURL),
		volcengineBaseURL: valueOrDefault(strings.TrimRight(config.VolcengineBaseURL, "/"), defaultVolcengineBaseURL),
		client:            client,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return string(generation.ProviderTypeOfficial)
}

// Generate dispatches a first-party generation request.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}

	route, err := resolveRoute(request)
	if err != nil {
		return generation.Response{}, err
	}
	if err := generation.ValidateRequestForRoute(request, route); err != nil {
		return generation.Response{}, err
	}
	request = generation.ApplyRoute(request, route)

	switch route.Adapter {
	case generation.AdapterOfficialOpenAIChatText:
		return provider.generateText(ctx, request)
	case generation.AdapterOfficialOpenAIImage:
		return provider.generateOpenAIImage(ctx, request)
	case generation.AdapterOfficialGoogleImage:
		return provider.generateGoogleImage(ctx, request)
	case generation.AdapterOfficialVolcengineImage:
		return provider.generateVolcengineImage(ctx, request)
	case generation.AdapterOfficialVolcengineVideo:
		return provider.createVolcengineVideo(ctx, request)
	default:
		return generation.Response{}, fmt.Errorf("unsupported official adapter %q", route.Adapter)
	}
}

// Get fetches async official task status by id.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	prefix, taskID := splitTaskID(id)
	if prefix == "" || taskID == "" {
		return generation.Response{}, fmt.Errorf("official generation id must include a route prefix")
	}

	route, ok := generation.FindRoute(prefix)
	if !ok {
		return generation.Response{}, fmt.Errorf("unknown generation route %q", prefix)
	}
	switch route.Adapter {
	case generation.AdapterOfficialVolcengineVideo:
		return provider.getVolcengineVideo(ctx, route, taskID)
	default:
		return generation.Response{}, fmt.Errorf("route %q does not expose async status", prefix)
	}
}

func resolveRoute(request generation.Request) (generation.ModelRoute, error) {
	route, err := generation.ResolveRoute(generation.RouteQuery{
		Kind:    request.Kind,
		RouteID: request.RouteID,
		ModelID: request.ModelID,
	})
	if err != nil {
		return generation.ModelRoute{}, err
	}
	if generation.ProviderTypeOf(route.Provider) != generation.ProviderTypeOfficial {
		return generation.ModelRoute{}, fmt.Errorf("route %q uses provider %q, not an official provider", route.ID, route.Provider)
	}
	return route, nil
}

func (provider *Provider) postJSON(ctx context.Context, endpoint string, authorization string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", authorization)

	return provider.doJSON(request, result)
}

func (provider *Provider) postStream(ctx context.Context, endpoint string, authorization string, payload any) (io.ReadCloser, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", authorization)

	response, err := provider.client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		return nil, readHTTPError(response)
	}

	return response.Body, nil
}

func (provider *Provider) postGoogleJSON(ctx context.Context, endpoint string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-goog-api-key", provider.apiKey)

	return provider.doJSON(request, result)
}

func (provider *Provider) getJSON(ctx context.Context, endpoint string, authorization string, result any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", authorization)

	return provider.doJSON(request, result)
}

func (provider *Provider) doJSON(request *http.Request, result any) error {
	response, err := provider.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return readHTTPError(response)
	}

	return json.NewDecoder(response.Body).Decode(result)
}

func (provider *Provider) bearerAuthorization() string {
	if strings.HasPrefix(strings.ToLower(provider.apiKey), "bearer ") {
		return provider.apiKey
	}

	return "Bearer " + provider.apiKey
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

func paramBool(params map[string]any, key string, fallback bool) bool {
	return adapterutil.ParamBool(params, key, fallback)
}

func paramBoolValueOnly(params map[string]any, key string) (bool, bool) {
	return adapterutil.ParamBoolValueOnly(params, key)
}

func boolParamValue(params map[string]any, key string, value *bool, fallback bool) bool {
	return adapterutil.BoolParamValue(params, key, value, fallback)
}

func boolParamPointer(params map[string]any, key string, value *bool, fallback bool) *bool {
	return adapterutil.BoolParamPointer(params, key, value, fallback)
}

func compactStrings(values []string) []string {
	return adapterutil.CompactStrings(values)
}

func normalizeVideoStatus(status string) string {
	return adapterutil.NormalizeVideoStatus(status)
}

func readHTTPError(response *http.Response) error {
	return generation.HTTPErrorFromResponse(string(generation.ProviderTypeOfficial), response)
}
