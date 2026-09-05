// Package whereslowimage implements the single WhereSlow Gemini image route.
package whereslowimage

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

// Protocol selects the wire protocol used by a custom image endpoint.
type Protocol string

const (
	// ProtocolGemini calls Gemini generateContent.
	ProtocolGemini Protocol = "gemini_generate_content"
)

// Config controls the custom image provider.
type Config struct {
	BaseURL    string
	APIKey     string
	Protocol   Protocol
	HTTPClient *http.Client
}

// Provider calls a user-configured image generation endpoint.
type Provider struct {
	baseURL  string
	apiKey   string
	protocol Protocol
	client   *http.Client
}

// Endpoint returns the credential-free endpoint used by a custom image request.
func Endpoint(baseURL string, model string, protocol Protocol) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return baseURL + "/v1beta/models/" + url.PathEscape(strings.TrimSpace(model)) + ":generateContent"
}

// NewProvider creates a custom image provider.
func NewProvider(config Config) (*Provider, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("custom image API base URL is required")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" {
		return nil, fmt.Errorf("custom image API base URL is invalid")
	}

	if strings.TrimSpace(config.APIKey) == "" {
		return nil, generation.ErrMissingAPIKey
	}

	protocol := config.Protocol
	if protocol != ProtocolGemini {
		return nil, fmt.Errorf(
			"unsupported custom image API protocol %q",
			protocol,
		)
	}

	client := config.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: 1000 * time.Second,
		}
	}

	return &Provider{
		baseURL:  baseURL,
		apiKey:   strings.TrimSpace(config.APIKey),
		protocol: protocol,
		client:   client,
	}, nil
}

// Name returns the provider identifier.
func (provider *Provider) Name() string {
	return generation.ProviderWhereslowImage
}

// Generate creates images with the configured protocol
// and preserves request.Model verbatim.
func (provider *Provider) Generate(
	ctx context.Context,
	request generation.Request,
) (generation.Response, error) {

	if request.Kind != generation.KindImage {
		return generation.Response{},
			fmt.Errorf(
				"%q: %w",
				request.Kind,
				generation.ErrUnsupportedKind,
			)
	}

	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}

	if strings.TrimSpace(request.Model) == "" {
		return generation.Response{},
			fmt.Errorf("custom image model is required")
	}

	count := paramInt(request.Params, "n", 1)

	if count < 1 {
		count = 1
	}

	if count > 4 {
		count = 4
	}

	combined := generation.Response{
		Status: "completed",
		Model:  request.Model,
	}

	for index := 0; index < count; index++ {
		response, err := provider.generateGemini(ctx, request)

		if err != nil {
			return generation.Response{}, err
		}

		combined.Assets = append(
			combined.Assets,
			response.Assets...,
		)

		combined.Usage.InputTokens +=
			response.Usage.InputTokens

		combined.Usage.OutputTokens +=
			response.Usage.OutputTokens

		combined.Usage.TotalTokens +=
			response.Usage.TotalTokens
	}

	return combined, nil
}

// Get is unsupported because the image API is synchronous.
func (provider *Provider) Get(
	context.Context,
	string,
) (generation.Response, error) {

	return generation.Response{},
		fmt.Errorf(
			"custom image API does not expose async tasks",
		)
}

type geminiRequest struct {
	Contents []geminiContent `json:"contents"`

	GenerationConfig struct {
		ResponseModalities []string `json:"responseModalities"`

		ImageConfig struct {
			AspectRatio string `json:"aspectRatio,omitempty"`
			ImageSize   string `json:"imageSize,omitempty"`
		} `json:"imageConfig,omitempty"`
	} `json:"generationConfig"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text,omitempty"`

	InlineData *geminiInlineData `json:"inlineData,omitempty"`

	InlineDataSnake *geminiInlineData `json:"inline_data,omitempty"`

	FileData *geminiFileData `json:"fileData,omitempty"`

	FileDataSnake *geminiFileData `json:"file_data,omitempty"`

	ImageURL *imageURL `json:"image_url,omitempty"`
}

type geminiInlineData struct {
	MIMEType string `json:"mimeType,omitempty"`

	MIMETypeSnake string `json:"mime_type,omitempty"`

	Data string `json:"data"`
}

type geminiFileData struct {
	MIMEType string `json:"mimeType,omitempty"`

	MIMETypeSnake string `json:"mime_type,omitempty"`

	FileURI string `json:"fileUri,omitempty"`

	FileURISnake string `json:"file_uri,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`

		FinishReason string `json:"finishReason"`

		SafetyRatings any `json:"safetyRatings,omitempty"`
	} `json:"candidates"`

	PromptFeedback any `json:"promptFeedback,omitempty"`

	Error any `json:"error,omitempty"`

	Message any `json:"message,omitempty"`

	UsageMetadata struct {
		PromptTokenCount int `json:"promptTokenCount"`

		CandidatesTokenCount int `json:"candidatesTokenCount"`

		TotalTokenCount int `json:"totalTokenCount"`
	} `json:"usageMetadata"`

	Choices []struct {
		Message struct {
			Images []struct {
				ImageURL imageURL `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`

	Data []compatImage `json:"data"`

	Images []compatImage `json:"images"`

	Image *compatImage `json:"image"`
}

type compatImage struct {
	URL string `json:"url"`

	B64JSON string `json:"b64_json"`

	Data string `json:"data"`

	MIMEType string `json:"mimeType"`

	MIMESnake string `json:"mime_type"`
}

func (provider *Provider) generateGemini(
	ctx context.Context,
	request generation.Request,
) (generation.Response, error) {

	parts := []geminiPart{
		{
			Text: request.Prompt,
		},
	}

	for _, reference := range compactStrings(request.ReferenceURLs) {

		mimeType, data, err :=
			adapterutil.ReadImageReference(
				ctx,
				provider.client,
				reference,
				func(response *http.Response) error {
					return provider.httpError(
						response,
						request.Model,
					)
				},
			)

		if err != nil {
			return generation.Response{},
				fmt.Errorf(
					"reading custom image reference: %w",
					err,
				)
		}

		parts = append(
			parts,
			geminiPart{
				InlineData: &geminiInlineData{
					MIMEType: mimeType,

					Data: base64.StdEncoding.
						EncodeToString(data),
				},
			},
		)
	}

	payload := geminiRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
	}

	// 强制要求 Gemini 返回图片。
	payload.GenerationConfig.ResponseModalities =
		[]string{"IMAGE"}

	// 兼容前端不同的比例字段命名。
	payload.GenerationConfig.ImageConfig.AspectRatio =
		wsNormalizeAspectRatio(
			firstNonEmpty(
				paramString(
					request.Params,
					"aspectRatio",
					"",
				),

				paramString(
					request.Params,
					"aspect_ratio",
					"",
				),

				"1:1",
			),
		)

	// 关键：
	// 同时兼容 imageSize / image_size / resolution。
	// 前端选择 4K 时最终必须得到 "4K"。
	payload.GenerationConfig.ImageConfig.ImageSize =
		wsNormalizeImageSize(
			firstNonEmpty(
				paramString(
					request.Params,
					"imageSize",
					"",
				),

				paramString(
					request.Params,
					"image_size",
					"",
				),

				paramString(
					request.Params,
					"resolution",
					"",
				),

				"1K",
			),
		)

	// 打印实际发送的图片参数。
	// 不包含 API Key。
	slog.Info(
		"[ImageGenerationConfig]",
		"aspect_ratio",
		payload.GenerationConfig.ImageConfig.AspectRatio,
		"image_size",
		payload.GenerationConfig.ImageConfig.ImageSize,
	)

	endpoint :=
		Endpoint(
			provider.baseURL,
			request.Model,
			ProtocolGemini,
		)

	requestEndpoint :=
		endpoint +
			"?key=" +
			url.QueryEscape(provider.apiKey)

	var raw json.RawMessage

	if err := provider.postJSON(
		ctx,
		requestEndpoint,
		endpoint,
		request.Model,
		payload,
		&raw,
	); err != nil {

		return generation.Response{}, err
	}

	return parseGeminiResponse(
		raw,
		request.Model,
	)
}

func (provider *Provider) postJSON(
	ctx context.Context,
	requestEndpoint string,
	safeEndpoint string,
	model string,
	payload any,
	result any,
) error {

	body, err := json.Marshal(payload)

	if err != nil {
		return err
	}

	httpRequest, err :=
		http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			requestEndpoint,
			bytes.NewReader(body),
		)

	if err != nil {
		return err
	}

	httpRequest.Header.Set(
		"Content-Type",
		"application/json",
	)

	httpRequest.Header.Set(
		"Accept",
		"application/json",
	)

	slog.Info(
		"[ImageGeneration]",
		"provider",
		provider.Name(),
		"protocol",
		string(provider.protocol),
		"base_url",
		provider.baseURL,
		"model",
		model,
		"endpoint",
		safeEndpoint,
	)

	response, err :=
		provider.client.Do(httpRequest)

	if err != nil {
		// 不包装底层 transport error，
		// 避免错误信息里意外暴露包含 API Key 的 URL。
		return fmt.Errorf(
			"custom image API request failed for %s",
			safeEndpoint,
		)
	}

	defer response.Body.Close()

	if response.StatusCode < http.StatusOK ||
		response.StatusCode >= http.StatusMultipleChoices {

		return provider.httpError(
			response,
			model,
			safeEndpoint,
		)
	}

	if err :=
		json.NewDecoder(response.Body).
			Decode(result); err != nil {

		return fmt.Errorf(
			"decoding custom image API response: %w",
			err,
		)
	}

	return nil
}

func (provider *Provider) httpError(
	response *http.Response,
	model string,
	endpoints ...string,
) error {

	err :=
		generation.HTTPErrorFromResponse(
			provider.Name(),
			response,
		)

	var httpErr *generation.HTTPError

	if errors.As(err, &httpErr) {
		httpErr.Model = model

		if len(endpoints) > 0 {
			httpErr.Endpoint =
				strings.TrimSpace(
					endpoints[0],
				)
		}
	}

	return err
}

// 统一比例。
// 如果前端传的是 16:9，就保持 16:9。
func wsNormalizeAspectRatio(
	value string,
) string {

	value =
		strings.TrimSpace(value)

	switch value {

	case "1:1",
		"1:4",
		"1:3",
		"4:1",
		"8:1",
		"2:3",
		"3:2",
		"3:4",
		"4:3",
		"4:5",
		"5:4",
		"9:16",
		"9:21",
		"16:9",
		"21:9":

		return value

	default:
		return "1:1"
	}
}

// 统一图片分辨率。
// 重点保证“超清4K”等字符串最终转换成 API 需要的 "4K"。
func wsNormalizeImageSize(
	value string,
) string {

	value =
		strings.ToUpper(
			strings.TrimSpace(value),
		)

	switch {

	case strings.Contains(value, "4K"):
		return "4K"

	case strings.Contains(value, "2K"):
		return "2K"

	case strings.Contains(value, "1K"):
		return "1K"

	case strings.Contains(value, "512"):
		return "512"

	default:
		return "1K"
	}
}

func compactStrings(
	values []string,
) []string {

	result :=
		make(
			[]string,
			0,
			len(values),
		)

	for _, value := range values {

		if value =
			strings.TrimSpace(value); value != "" {

			result =
				append(
					result,
					value,
				)
		}
	}

	return result
}

func firstNonEmpty(
	values ...string,
) string {

	for _, value := range values {

		if value =
			strings.TrimSpace(value); value != "" {

			return value
		}
	}

	return ""
}

func paramString(
	params map[string]any,
	name string,
	fallback string,
) string {

	if value, ok :=
		params[name].(string); ok &&
		strings.TrimSpace(value) != "" {

		return strings.TrimSpace(value)
	}

	return fallback
}

func paramInt(
	params map[string]any,
	name string,
	fallback int,
) int {

	switch value :=
		params[name].(type) {

	case int:
		return value

	case float64:
		return int(value)

	default:
		return fallback
	}
}
