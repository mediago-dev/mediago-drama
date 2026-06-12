package generation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/runtime"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/multimodal"
)

const (
	defaultOpenAIChatBaseURL     = "https://api.openai.com/v1"
	defaultDMXChatBaseURL        = "https://www.dmxapi.cn/v1"
	defaultOpenRouterChatBaseURL = "https://openrouter.ai/api/v1"
)

// MultimodalImageInput is one image sent to a vision-capable text model.
type MultimodalImageInput struct {
	Data     []byte
	MIMEType string
	Name     string
	URI      string
}

// MultimodalCompletionRequest requests a non-persisted multimodal completion.
type MultimodalCompletionRequest struct {
	Prompt  string
	Images  []MultimodalImageInput
	RouteID string
	Model   string
	Params  map[string]any
}

type openAICompatibleMultimodalProvider struct {
	name    string
	baseURL string
	apiKey  string
	headers map[string]string
	client  *http.Client
}

// CompleteMultimodal runs one text completion with image inputs.
func (workflow *GenerationService) CompleteMultimodal(ctx context.Context, request MultimodalCompletionRequest) (string, error) {
	if workflow == nil {
		return "", fmt.Errorf("generation service is nil")
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}
	if len(request.Images) == 0 {
		return workflow.CompleteText(ctx, TextCompletionRequest{
			Prompt:  prompt,
			RouteID: request.RouteID,
			Model:   request.Model,
			Params:  request.Params,
		})
	}
	route, err := workflow.resolveConfiguredTextRoute(request.RouteID)
	if err != nil {
		return "", err
	}
	provider, err := workflow.newMultimodalProvider(ctx, route)
	if err != nil {
		return "", err
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = route.Model
	}
	parts := []multimodal.Part{{
		Modality: multimodal.ModalityText,
		Text:     prompt,
	}}
	for _, image := range request.Images {
		part, err := multimodalPartFromImageInput(image)
		if err != nil {
			return "", err
		}
		parts = append(parts, part)
	}
	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()
	response, err := provider.Generate(runCtx, multimodal.GenerateRequest{
		Messages: []multimodal.Message{{
			Role:  multimodal.RoleUser,
			Parts: parts,
		}},
		Options: multimodal.GenerateOptions{
			Model:       model,
			Temperature: float32Option(request.Params, "temperature"),
			MaxTokens:   intOption(request.Params, "maxTokens"),
			Metadata: map[string]any{
				"route_id":   route.ID,
				"family_id":  route.FamilyID,
				"version_id": route.VersionID,
				"provider":   route.Provider,
				"model_id":   route.LegacyModelID,
			},
		},
	})
	if err != nil {
		return "", err
	}
	return textFromMultimodalResponse(response), nil
}

func (workflow *GenerationService) newMultimodalProvider(ctx context.Context, route coregeneration.ModelRoute) (multimodal.Provider, error) {
	factory := workflow.multimodalTextProviderFactory
	if factory == nil {
		factory = defaultMultimodalTextProviderFactory
	}
	credentials, err := workflow.routeCredentials(ctx, route)
	if err != nil {
		return nil, err
	}
	provider, err := factory(ctx, route, credentials)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, fmt.Errorf("generation route %q does not support multimodal completion", route.ID)
	}
	return provider, nil
}

func (workflow *GenerationService) routeCredentials(ctx context.Context, route coregeneration.ModelRoute) (runtime.RouteCredentials, error) {
	if len(route.AuthKeys) == 0 {
		return nil, coregeneration.ErrMissingAPIKey
	}
	credentials := make(runtime.RouteCredentials, len(route.AuthKeys))
	for _, key := range route.AuthKeys {
		value, _, err := workflow.settings.GetAPIKey(ctx, key)
		if err != nil {
			return nil, err
		}
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, coregeneration.ErrMissingAPIKey
		}
		credentials[key] = value
	}
	return credentials, nil
}

func defaultMultimodalTextProviderFactory(
	_ context.Context,
	route coregeneration.ModelRoute,
	credentials runtime.RouteCredentials,
) (multimodal.Provider, error) {
	if route.Kind != coregeneration.KindText {
		return nil, nil
	}
	apiKey := firstRouteCredential(route, credentials)
	if apiKey == "" {
		return nil, coregeneration.ErrMissingAPIKey
	}
	if coregeneration.ProviderTypeOf(route.Provider) == coregeneration.ProviderTypeOfficial {
		if route.Adapter != coregeneration.AdapterOfficialOpenAIChatText {
			return nil, nil
		}
		return newOpenAICompatibleMultimodalProvider(route.Provider, defaultOpenAIChatBaseURL, apiKey, nil), nil
	}

	switch route.Provider {
	case coregeneration.ProviderDMX:
		if route.Adapter != coregeneration.AdapterDMXChatText {
			return nil, nil
		}
		return newOpenAICompatibleMultimodalProvider("dmx", defaultDMXChatBaseURL, apiKey, nil), nil
	case coregeneration.ProviderOpenRouter:
		if route.Adapter != coregeneration.AdapterOpenRouterChatText {
			return nil, nil
		}
		return newOpenAICompatibleMultimodalProvider(
			"openrouter",
			defaultOpenRouterChatBaseURL,
			apiKey,
			map[string]string{"X-Title": "mediago-drama"},
		), nil
	default:
		return nil, nil
	}
}

func newOpenAICompatibleMultimodalProvider(name string, baseURL string, apiKey string, headers map[string]string) *openAICompatibleMultimodalProvider {
	return &openAICompatibleMultimodalProvider{
		name:    name,
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(apiKey),
		headers: headers,
		client:  &http.Client{Timeout: generationRequestTimeout},
	}
}

func (provider *openAICompatibleMultimodalProvider) Name() string {
	return provider.name
}

func (provider *openAICompatibleMultimodalProvider) Generate(ctx context.Context, request multimodal.GenerateRequest) (multimodal.GenerateResponse, error) {
	payload, err := provider.chatPayload(request)
	if err != nil {
		return multimodal.GenerateResponse{}, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return multimodal.GenerateResponse{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return multimodal.GenerateResponse{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", bearerAuthorization(provider.apiKey))
	for key, value := range provider.headers {
		httpRequest.Header.Set(key, value)
	}
	response, err := provider.client.Do(httpRequest)
	if err != nil {
		return multimodal.GenerateResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return multimodal.GenerateResponse{}, coregeneration.HTTPErrorFromResponse(provider.name, response)
	}
	var payloadResponse openAIChatCompletionResponse
	if err := json.NewDecoder(response.Body).Decode(&payloadResponse); err != nil {
		return multimodal.GenerateResponse{}, err
	}
	return payloadResponse.toMultimodalResponse(), nil
}

func (provider *openAICompatibleMultimodalProvider) chatPayload(request multimodal.GenerateRequest) (openAIChatCompletionRequest, error) {
	messages := make([]openAIChatMessage, 0, len(request.Messages))
	for _, message := range request.Messages {
		content, err := chatContentFromMultimodalParts(message.Parts)
		if err != nil {
			return openAIChatCompletionRequest{}, err
		}
		role := string(message.Role)
		if role == "" {
			role = string(multimodal.RoleUser)
		}
		messages = append(messages, openAIChatMessage{Role: role, Content: content})
	}
	return openAIChatCompletionRequest{
		Model:       strings.TrimSpace(request.Options.Model),
		Messages:    messages,
		Stream:      false,
		Temperature: float32ToFloat64(request.Options.Temperature),
		MaxTokens:   request.Options.MaxTokens,
	}, nil
}

type openAIChatCompletionRequest struct {
	Model       string              `json:"model"`
	Messages    []openAIChatMessage `json:"messages"`
	Stream      bool                `json:"stream"`
	Temperature *float64            `json:"temperature,omitempty"`
	MaxTokens   *int                `json:"max_tokens,omitempty"`
}

type openAIChatMessage struct {
	Role    string              `json:"role"`
	Content []openAIContentPart `json:"content"`
}

type openAIContentPart struct {
	Type     string              `json:"type"`
	Text     string              `json:"text,omitempty"`
	ImageURL *openAIImageURLPart `json:"image_url,omitempty"`
}

type openAIImageURLPart struct {
	URL string `json:"url"`
}

type openAIChatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (response openAIChatCompletionResponse) toMultimodalResponse() multimodal.GenerateResponse {
	text := ""
	if len(response.Choices) > 0 {
		text = response.Choices[0].Message.Content
	}
	return multimodal.GenerateResponse{
		Messages: []multimodal.Message{{
			Role: multimodal.RoleAssistant,
			Parts: []multimodal.Part{{
				Modality: multimodal.ModalityText,
				Text:     text,
			}},
		}},
		Usage: multimodal.Usage{
			InputTokens:  response.Usage.PromptTokens,
			OutputTokens: response.Usage.CompletionTokens,
			TotalTokens:  response.Usage.TotalTokens,
		},
	}
}

func chatContentFromMultimodalParts(parts []multimodal.Part) ([]openAIContentPart, error) {
	content := make([]openAIContentPart, 0, len(parts))
	for _, part := range parts {
		switch part.Modality {
		case multimodal.ModalityText:
			text := strings.TrimSpace(part.Text)
			if text != "" {
				content = append(content, openAIContentPart{Type: "text", Text: text})
			}
		case multimodal.ModalityImage:
			url, err := imageURLFromPart(part)
			if err != nil {
				return nil, err
			}
			content = append(content, openAIContentPart{
				Type:     "image_url",
				ImageURL: &openAIImageURLPart{URL: url},
			})
		default:
			return nil, fmt.Errorf("unsupported multimodal part %q", part.Modality)
		}
	}
	if len(content) == 0 {
		return nil, fmt.Errorf("message content is required")
	}
	return content, nil
}

func multimodalPartFromImageInput(input MultimodalImageInput) (multimodal.Part, error) {
	mimeType := strings.TrimSpace(input.MIMEType)
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	if len(input.Data) == 0 && strings.TrimSpace(input.URI) == "" {
		return multimodal.Part{}, fmt.Errorf("image data or uri is required")
	}
	return multimodal.Part{
		Modality: multimodal.ModalityImage,
		Data:     input.Data,
		MIMEType: mimeType,
		Name:     strings.TrimSpace(input.Name),
		URI:      strings.TrimSpace(input.URI),
	}, nil
}

func imageURLFromPart(part multimodal.Part) (string, error) {
	if uri := strings.TrimSpace(part.URI); uri != "" {
		return uri, nil
	}
	if len(part.Data) == 0 {
		return "", fmt.Errorf("image part is empty")
	}
	mimeType := strings.TrimSpace(part.MIMEType)
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(part.Data), nil
}

func textFromMultimodalResponse(response multimodal.GenerateResponse) string {
	var builder strings.Builder
	for _, message := range response.Messages {
		for _, part := range message.Parts {
			if part.Modality == multimodal.ModalityText {
				builder.WriteString(part.Text)
			}
		}
	}
	return builder.String()
}

func firstRouteCredential(route coregeneration.ModelRoute, credentials runtime.RouteCredentials) string {
	for _, key := range route.AuthKeys {
		if value := strings.TrimSpace(credentials[key]); value != "" {
			return value
		}
	}
	return ""
}

func bearerAuthorization(apiKey string) string {
	if strings.HasPrefix(strings.ToLower(apiKey), "bearer ") {
		return apiKey
	}
	return "Bearer " + apiKey
}

func float32Option(params map[string]any, key string) *float32 {
	value, ok := numberValue(params[key])
	if !ok {
		return nil
	}
	converted := float32(value)
	return &converted
}

func intOption(params map[string]any, key string) *int {
	value, ok := integerValue(params[key])
	if !ok {
		return nil
	}
	return &value
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func integerValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), typed == float64(int(typed))
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

func float32ToFloat64(value *float32) *float64 {
	if value == nil {
		return nil
	}
	converted := float64(*value)
	return &converted
}
