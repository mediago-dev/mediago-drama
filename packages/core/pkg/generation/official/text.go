package official

import (
	"context"
	"io"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/internal/openaichat"
)

// GenerateTextStream streams an OpenAI chat-completions text response.
func (provider *Provider) GenerateTextStream(ctx context.Context, request generation.Request) (generation.TextStream, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, generation.ErrMissingPrompt
	}
	route, err := resolveRoute(request)
	if err != nil {
		return nil, err
	}
	if err := generation.ValidateRequestForRoute(request, route); err != nil {
		return nil, err
	}
	request = generation.ApplyRoute(request, route)

	body, err := provider.postStream(ctx, provider.openAIBaseURL+"/v1/chat/completions", provider.bearerAuthorization(), officialChatTextPayload(request))
	if err != nil {
		return nil, err
	}

	return openaichat.NewStream(body), nil
}

func (provider *Provider) generateText(ctx context.Context, request generation.Request) (generation.Response, error) {
	stream, err := provider.GenerateTextStream(ctx, request)
	if err != nil {
		return generation.Response{}, err
	}
	defer stream.Close()

	var builder strings.Builder
	var usage generation.Usage
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return generation.Response{}, err
		}
		builder.WriteString(event.Delta)
		if event.Usage != nil {
			usage = *event.Usage
		}
	}

	return generation.Response{
		Status: "completed",
		Model:  request.Model,
		Text:   builder.String(),
		Usage:  usage,
	}, nil
}

type officialChatTextRequest struct {
	Model         string                `json:"model"`
	Messages      []officialChatMessage `json:"messages"`
	Stream        bool                  `json:"stream"`
	StreamOptions map[string]any        `json:"stream_options,omitempty"`
	Temperature   *float64              `json:"temperature,omitempty"`
	MaxTokens     *int                  `json:"max_tokens,omitempty"`
}

type officialChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func officialChatTextPayload(request generation.Request) officialChatTextRequest {
	return officialChatTextRequest{
		Model:         request.Model,
		Messages:      []officialChatMessage{{Role: "user", Content: request.Prompt}},
		Stream:        true,
		StreamOptions: map[string]any{"include_usage": true},
		Temperature:   paramFloatPointer(request.Params, "temperature"),
		MaxTokens:     paramIntPointer(request.Params, "maxTokens"),
	}
}

func paramFloatPointer(params map[string]any, key string) *float64 {
	if len(params) == 0 {
		return nil
	}
	value, ok := adapterutil.FloatValue(params[key])
	if !ok {
		return nil
	}

	return &value
}
