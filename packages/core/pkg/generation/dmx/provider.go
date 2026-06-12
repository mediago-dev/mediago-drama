// Package dmx adapts DMXAPI media generation endpoints to core generation contracts.
package dmx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

const (
	defaultBaseURL             = "https://www.dmxapi.cn"
	defaultHTTPClient          = 1000 * time.Second
	defaultTLSHandshakeTimeout = 45 * time.Second
	maxTLSHandshakeAttempts    = 2
)

// Config controls the DMXAPI provider.
type Config struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// Provider calls DMXAPI image and video generation endpoints.
type Provider struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// NewProvider creates a DMXAPI generation provider.
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
		client = defaultClient()
	}

	return &Provider{
		baseURL: baseURL,
		apiKey:  config.APIKey,
		client:  client,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "dmx"
}

// Generate dispatches an image or video generation request.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}

	if route, ok, err := resolveCatalogRoute(request); err != nil {
		return generation.Response{}, err
	} else if ok {
		if err := generation.ValidateRequestForRoute(request, route); err != nil {
			return generation.Response{}, err
		}
		originalRouteID := request.RouteID
		request = generation.ApplyRoute(request, route)
		if originalRouteID == "" {
			request.RouteID = ""
		}
		switch route.Adapter {
		case generation.AdapterDMXChatText:
			return provider.generateText(ctx, request)
		case generation.AdapterDMXResponsesImage:
			return provider.generateImage(ctx, request)
		case generation.AdapterDMXImagesGenerations:
			return provider.generateImages(ctx, request)
		case generation.AdapterDMXGeminiGenerate:
			return provider.generateGeminiImage(ctx, request)
		case generation.AdapterDMXResponsesVideo:
			return provider.createResponsesVideo(ctx, request)
		default:
			return generation.Response{}, fmt.Errorf("unsupported dmx adapter %q", route.Adapter)
		}
	}

	switch request.Kind {
	case generation.KindImage:
		return provider.generateImage(ctx, request)
	case generation.KindVideo:
		return provider.createVideo(ctx, request)
	case generation.KindText:
		return provider.generateText(ctx, request)
	default:
		return generation.Response{}, fmt.Errorf("%q: %w", request.Kind, generation.ErrUnsupportedKind)
	}
}

// Get fetches video task status by id.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	if id == "" {
		return generation.Response{}, fmt.Errorf("generation id is required")
	}

	modelID, taskID := splitTaskID(id)
	if modelID != "" {
		route, ok := generation.FindRouteByTaskPrefix(modelID)
		if !ok {
			return generation.Response{}, fmt.Errorf("unknown generation model %q", modelID)
		}
		if route.Provider != generation.ProviderDMX {
			return generation.Response{}, fmt.Errorf("generation model %q uses provider %q, not %q", modelID, route.Provider, generation.ProviderDMX)
		}

		switch route.Adapter {
		case generation.AdapterDMXResponsesVideo:
			return provider.getResponsesVideo(ctx, route, modelID, taskID)
		default:
			return generation.Response{}, fmt.Errorf("model %q does not expose async generation", modelID)
		}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, provider.baseURL+"/v1/videos/"+id, nil)
	if err != nil {
		return generation.Response{}, err
	}
	request.Header.Set("Authorization", provider.videoAuthorization())

	response, err := provider.do(request)
	if err != nil {
		return generation.Response{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return generation.Response{}, readHTTPError(response)
	}

	var payload videoStatusResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return generation.Response{}, err
	}

	return payload.toGenerationResponse(), nil
}

func (provider *Provider) videoAuthorization() string {
	if strings.HasPrefix(strings.ToLower(provider.apiKey), "bearer ") {
		return provider.apiKey
	}

	return "Bearer " + provider.apiKey
}

func (provider *Provider) postJSON(
	ctx context.Context,
	endpoint string,
	payload any,
	authorization string,
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
	request.Header.Set("Authorization", authorization)

	return provider.doJSON(request, result)
}

func (provider *Provider) postStream(
	ctx context.Context,
	endpoint string,
	payload any,
	authorization string,
) (io.ReadCloser, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", authorization)

	response, err := provider.do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		return nil, readHTTPError(response)
	}

	return response.Body, nil
}

func (provider *Provider) postGeminiJSON(
	ctx context.Context,
	endpoint string,
	payload any,
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
	request.Header.Set("x-goog-api-key", provider.apiKey)

	return provider.doJSON(request, result)
}

func (provider *Provider) doJSON(request *http.Request, result any) error {
	response, err := provider.do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return readHTTPError(response)
	}

	return json.NewDecoder(response.Body).Decode(result)
}

func (provider *Provider) do(request *http.Request) (*http.Response, error) {
	attempts := maxTLSHandshakeAttempts
	if request.GetBody == nil {
		attempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		attemptRequest := request
		if attempt > 1 {
			body, err := request.GetBody()
			if err != nil {
				return nil, err
			}
			attemptRequest = request.Clone(request.Context())
			attemptRequest.Body = body
		}
		response, err := provider.doOnce(attemptRequest, attempt)
		if err == nil {
			return response, nil
		}
		lastErr = err
		if attempt >= attempts || !isTLSHandshakeTimeout(err) {
			return nil, err
		}
		if err := waitBeforeRetry(request.Context(), 400*time.Millisecond); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func (provider *Provider) doOnce(request *http.Request, attempt int) (*http.Response, error) {
	startedAt := time.Now()
	urlValue := ""
	if request.URL != nil {
		urlValue = request.URL.String()
	}

	slog.Info(
		"dmx http request started",
		"method", request.Method,
		"url", urlValue,
		"attempt", attempt,
	)
	response, err := provider.client.Do(request)
	duration := time.Since(startedAt)
	if err != nil {
		slog.Warn(
			"dmx http request failed",
			"method", request.Method,
			"url", urlValue,
			"attempt", attempt,
			"duration_ms", duration.Milliseconds(),
			"error", err,
		)
		return nil, err
	}

	slog.Info(
		"dmx http request completed",
		"method", request.Method,
		"url", urlValue,
		"status", response.StatusCode,
		"attempt", attempt,
		"duration_ms", duration.Milliseconds(),
	)
	return response, nil
}

func defaultClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSHandshakeTimeout = defaultTLSHandshakeTimeout
	return &http.Client{
		Timeout:   defaultHTTPClient,
		Transport: transport,
	}
}

func isTLSHandshakeTimeout(err error) bool {
	if err == nil {
		return false
	}
	if strings.Contains(err.Error(), "TLS handshake timeout") {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout() && strings.Contains(err.Error(), "TLS")
}

func waitBeforeRetry(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func resolveCatalogRoute(request generation.Request) (generation.ModelRoute, bool, error) {
	route, ok, err := generation.ResolveRequestRouteForProvider(request, generation.ProviderDMX)
	if err != nil || ok {
		return route, ok, err
	}

	if request.Kind == generation.KindImage && request.Model == "" {
		route, err := generation.ResolveDefaultRouteForProvider(generation.KindImage, generation.ProviderDMX)
		return route, err == nil, err
	}

	return generation.ModelRoute{}, false, nil
}

func valueOrDefault(value string, fallback string) string {
	return adapterutil.ValueOrDefault(value, fallback)
}

func firstNonEmpty(values ...string) string {
	return adapterutil.FirstNonEmpty(values...)
}

func joinTaskID(modelID string, taskID string) string {
	return adapterutil.JoinTaskID(modelID, taskID)
}

func taskIDPrefix(request generation.Request) string {
	if request.RouteID != "" {
		return request.RouteID
	}

	return request.ModelID
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

func boolParamPointer(params map[string]any, key string, value *bool, fallback bool) *bool {
	return adapterutil.BoolParamPointer(params, key, value, fallback)
}

func compactStrings(values []string) []string {
	return adapterutil.CompactStrings(values)
}

func stringFromMap(values map[string]any, key string) string {
	return adapterutil.StringFromMap(values, key)
}

func normalizeVideoStatus(status string) string {
	return adapterutil.NormalizeVideoStatus(status)
}

func readHTTPError(response *http.Response) error {
	err := generation.HTTPErrorFromResponse(generation.ProviderDMX, response)
	var httpErr *generation.HTTPError
	if errors.As(err, &httpErr) {
		applyDMXHTTPErrorInfo(httpErr)
	}
	return err
}

func applyDMXHTTPErrorInfo(err *generation.HTTPError) {
	if err == nil {
		return
	}

	code, message, errorType := dmxHTTPErrorFields(err.Body)
	reason, canonicalCode, canonicalMessage, retryable := classifyDMXFailure(
		err.StatusCode,
		code,
		message,
		errorType,
		err.Body,
	)
	err.Code = firstNonEmpty(canonicalCode, normalizeDMXErrorCode(code), err.Code)
	err.Reason = reason
	err.Message = firstNonEmpty(canonicalMessage, message, err.Message)
	err.Retryable = retryable
}

func dmxHTTPErrorFields(body string) (string, string, string) {
	var values map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(body)), &values); err != nil {
		return "", strings.TrimSpace(body), ""
	}
	return dmxErrorFieldsFromMap(values)
}

func dmxErrorFieldsFromMap(values map[string]any) (string, string, string) {
	if inner, ok := values["error"].(map[string]any); ok {
		return dmxErrorFieldsFromMap(inner)
	}

	code := stringFromMap(values, "code")
	message := stringFromMap(values, "message")
	errorType := stringFromMap(values, "type")
	if nested := dmxNestedErrorMap(message); nested != nil {
		nestedCode, nestedMessage, nestedType := dmxErrorFieldsFromMap(nested)
		code = firstNonEmpty(nestedCode, code)
		message = firstNonEmpty(nestedMessage, message)
		errorType = firstNonEmpty(nestedType, errorType)
	}

	return code, message, errorType
}

func dmxNestedErrorMap(message string) map[string]any {
	offset := 0
	for {
		index := strings.Index(message[offset:], "{")
		if index < 0 {
			return nil
		}
		start := offset + index
		candidate := message[start:]
		var values map[string]any
		if err := json.Unmarshal([]byte(candidate), &values); err == nil {
			return values
		}
		if end := strings.LastIndex(candidate, "}"); end >= 0 {
			if err := json.Unmarshal([]byte(candidate[:end+1]), &values); err == nil {
				return values
			}
		}
		offset = start + 1
	}
}

func classifyDMXFailure(
	statusCode int,
	code string,
	message string,
	errorType string,
	raw string,
) (generation.FailureReason, string, string, bool) {
	normalized := strings.ToLower(strings.Join([]string{code, message, errorType, raw}, " "))
	if strings.Contains(normalized, "policyviolation") ||
		strings.Contains(normalized, "copyright restrictions") {
		return generation.FailurePolicyViolation,
			"policy_violation",
			"Provider policy rejected the generation request or result.",
			false
	}
	if strings.Contains(normalized, "invalidparameter") ||
		strings.Contains(normalized, "badrequest") {
		return generation.FailureInvalidParameter,
			"invalid_parameter",
			firstNonEmpty(message, "Provider rejected request parameters."),
			false
	}
	if statusCode == http.StatusTooManyRequests {
		return generation.FailureRateLimited, "rate_limited", "Provider rate limit exceeded.", true
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return generation.FailureAuthentication, "authentication", "Provider authentication failed.", false
	}
	if statusCode >= 500 {
		return generation.FailureProviderError, "provider_http_error", "Provider service failed.", true
	}

	return generation.FailureProviderError,
		firstNonEmpty(normalizeDMXErrorCode(code), "provider_http_error"),
		firstNonEmpty(message, "Provider request failed."),
		false
}

func normalizeDMXErrorCode(code string) string {
	normalized := strings.TrimSpace(code)
	if normalized == "" {
		return ""
	}
	normalized = strings.TrimPrefix(normalized, "***.")
	normalized = strings.ToLower(normalized)
	normalized = strings.ReplaceAll(normalized, ".", "_")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	return normalized
}
