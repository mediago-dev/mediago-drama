package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/multimodal"
)

// RouteCredentials carries credential values resolved for a catalog route.
type RouteCredentials map[string]string

// MultimodalTextProviderFactory creates a multimodal provider for a text route.
//
// Returning nil lets the runtime fall back to the route's legacy generation
// provider.
type MultimodalTextProviderFactory func(
	ctx context.Context,
	route generation.ModelRoute,
	credentials RouteCredentials,
) (multimodal.Provider, error)

// MultimodalTextProvider adapts a multimodal provider to the generation text
// provider contract.
type MultimodalTextProvider struct {
	provider multimodal.Provider
}

// NewMultimodalTextProvider creates a generation text provider backed by a
// multimodal provider.
func NewMultimodalTextProvider(provider multimodal.Provider) (*MultimodalTextProvider, error) {
	if provider == nil {
		return nil, fmt.Errorf("multimodal provider is nil")
	}

	return &MultimodalTextProvider{provider: provider}, nil
}

// Name returns the adapted provider name.
func (provider *MultimodalTextProvider) Name() string {
	return "multimodal:" + provider.provider.Name()
}

// Generate runs a non-streaming text request through the multimodal provider.
func (provider *MultimodalTextProvider) Generate(
	ctx context.Context,
	request generation.Request,
) (generation.Response, error) {
	multimodalRequest, err := multimodalRequestFromGeneration(request)
	if err != nil {
		return generation.Response{}, err
	}

	response, err := provider.provider.Generate(ctx, multimodalRequest)
	if err != nil {
		return generation.Response{}, err
	}

	return generationResponseFromMultimodal(request, provider.provider.Name(), response), nil
}

// GenerateTextStream runs a streaming text request through the multimodal
// provider.
func (provider *MultimodalTextProvider) GenerateTextStream(
	ctx context.Context,
	request generation.Request,
) (generation.TextStream, error) {
	multimodalRequest, err := multimodalRequestFromGeneration(request)
	if err != nil {
		return nil, err
	}

	streamProvider, ok := provider.provider.(multimodal.StreamProvider)
	if !ok {
		return nil, fmt.Errorf(
			"multimodal provider %q does not support text streaming: %w",
			provider.provider.Name(),
			generation.ErrTextStreamingUnsupported,
		)
	}

	reader, err := streamProvider.Stream(ctx, multimodalRequest)
	if err != nil {
		return nil, err
	}

	return &multimodalTextStream{reader: reader}, nil
}

// Get is unsupported for synchronous multimodal text providers.
func (provider *MultimodalTextProvider) Get(context.Context, string) (generation.Response, error) {
	return generation.Response{}, fmt.Errorf("multimodal text provider %q does not support task lookup", provider.provider.Name())
}

func multimodalRequestFromGeneration(request generation.Request) (multimodal.GenerateRequest, error) {
	if request.Kind != "" && request.Kind != generation.KindText {
		return multimodal.GenerateRequest{}, fmt.Errorf("generation kind %q is not text", request.Kind)
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return multimodal.GenerateRequest{}, generation.ErrMissingPrompt
	}

	return multimodal.GenerateRequest{
		Messages: []multimodal.Message{
			{
				Role: multimodal.RoleUser,
				Parts: []multimodal.Part{
					{
						Modality: multimodal.ModalityText,
						Text:     request.Prompt,
					},
				},
			},
		},
		Options: multimodal.GenerateOptions{
			Model:       request.Model,
			Temperature: float32Option(request.Params, request.Options, "temperature"),
			MaxTokens:   intOption(request.Params, request.Options, "maxTokens"),
			TopP:        float32Option(request.Params, request.Options, "topP"),
			Stop:        stringSliceOption(request.Params, request.Options, "stop"),
			Metadata: map[string]any{
				"route_id":   request.RouteID,
				"family_id":  request.FamilyID,
				"version_id": request.VersionID,
				"provider":   request.Provider,
				"model_id":   request.ModelID,
			},
		},
	}, nil
}

func generationResponseFromMultimodal(
	request generation.Request,
	providerName string,
	response multimodal.GenerateResponse,
) generation.Response {
	metadata := map[string]any{
		"multimodal_provider": providerName,
	}
	for key, value := range response.Metadata {
		metadata[key] = value
	}

	return generation.Response{
		Status:   "completed",
		Model:    request.Model,
		Text:     textFromMultimodalMessages(response.Messages),
		Usage:    usageFromMultimodal(response.Usage),
		Metadata: metadata,
	}
}

func textFromMultimodalMessages(messages []multimodal.Message) string {
	var builder strings.Builder
	for _, message := range messages {
		for _, part := range message.Parts {
			if part.Modality == multimodal.ModalityText {
				builder.WriteString(part.Text)
			}
		}
	}

	return builder.String()
}

func usageFromMultimodal(usage multimodal.Usage) generation.Usage {
	return generation.Usage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		TotalTokens:     usage.TotalTokens,
		ReasoningTokens: usage.ReasoningTokens,
		CachedTokens:    usage.CachedTokens,
	}
}

type multimodalTextStream struct {
	reader *multimodal.StreamReader
}

func (stream *multimodalTextStream) Recv() (generation.TextStreamEvent, error) {
	if stream == nil || stream.reader == nil {
		return generation.TextStreamEvent{}, io.EOF
	}

	for {
		event, err := stream.reader.Recv()
		if err != nil {
			return generation.TextStreamEvent{}, err
		}

		usage := generationUsagePointer(event.Usage)
		switch event.Type {
		case multimodal.StreamEventMessageDelta:
			return generation.TextStreamEvent{
				Delta: firstEventText(event),
				Usage: usage,
			}, nil
		case multimodal.StreamEventDone:
			return generation.TextStreamEvent{
				Usage: usage,
				Done:  true,
			}, nil
		case multimodal.StreamEventError:
			if event.Error == "" {
				return generation.TextStreamEvent{}, fmt.Errorf("multimodal stream error")
			}
			return generation.TextStreamEvent{}, fmt.Errorf("%s", event.Error)
		default:
			if usage != nil {
				return generation.TextStreamEvent{Usage: usage}, nil
			}
		}
	}
}

func (stream *multimodalTextStream) Close() error {
	if stream == nil || stream.reader == nil {
		return nil
	}

	return stream.reader.Close()
}

func generationUsagePointer(usage *multimodal.Usage) *generation.Usage {
	if usage == nil {
		return nil
	}
	converted := usageFromMultimodal(*usage)
	return &converted
}

func firstEventText(event multimodal.StreamEvent) string {
	if event.Delta != "" {
		return event.Delta
	}
	if event.Message == nil {
		return ""
	}

	return textFromMultimodalMessages([]multimodal.Message{*event.Message})
}

func float32Option(primary map[string]any, fallback map[string]any, key string) *float32 {
	if value, ok := numberValue(primary[key]); ok {
		converted := float32(value)
		return &converted
	}
	if value, ok := numberValue(fallback[key]); ok {
		converted := float32(value)
		return &converted
	}

	return nil
}

func intOption(primary map[string]any, fallback map[string]any, key string) *int {
	if value, ok := integerValue(primary[key]); ok {
		return &value
	}
	if value, ok := integerValue(fallback[key]); ok {
		return &value
	}

	return nil
}

func stringSliceOption(primary map[string]any, fallback map[string]any, key string) []string {
	if value, ok := stringSliceValue(primary[key]); ok {
		return value
	}
	if value, ok := stringSliceValue(fallback[key]); ok {
		return value
	}

	return nil
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
		parsed, err := strconv.ParseFloat(typed.String(), 64)
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
		if typed == float64(int(typed)) {
			return int(typed), true
		}
		return 0, false
	case float32:
		if typed == float32(int(typed)) {
			return int(typed), true
		}
		return 0, false
	case json.Number:
		parsed, err := strconv.Atoi(typed.String())
		return parsed, err == nil
	default:
		return 0, false
	}
}

func stringSliceValue(value any) ([]string, bool) {
	switch typed := value.(type) {
	case string:
		if typed == "" {
			return nil, false
		}
		return []string{typed}, true
	case []string:
		return typed, len(typed) > 0
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			result = append(result, text)
		}
		return result, len(result) > 0
	default:
		return nil, false
	}
}
