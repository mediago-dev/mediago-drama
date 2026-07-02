package openrouter

import (
	"context"
	"io"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/openaichat"
)

// GenerateTextStream streams an OpenRouter chat-completions text response.
func (provider *Provider) GenerateTextStream(ctx context.Context, request generation.Request) (generation.TextStream, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, generation.ErrMissingPrompt
	}
	if _, err := provider.resolveRequest(&request); err != nil {
		return nil, err
	}

	body, err := provider.postStream(ctx, "/chat/completions", chatTextPayload(request))
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

	return collectTextStream(stream, request.Model)
}

func chatTextPayload(request generation.Request) chatCompletionRequest {
	return chatCompletionRequest{
		Model:         request.Model,
		Messages:      []chatMessage{{Role: "user", Content: request.Prompt}},
		Stream:        true,
		StreamOptions: map[string]any{"include_usage": true},
		Temperature:   paramFloatPointer(request.Params, "temperature"),
		MaxTokens:     paramIntPointer(request.Params, "maxTokens"),
	}
}

func collectTextStream(stream generation.TextStream, model string) (generation.Response, error) {
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
		Model:  model,
		Text:   builder.String(),
		Usage:  usage,
	}, nil
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
