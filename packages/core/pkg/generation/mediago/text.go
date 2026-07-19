package mediago

import (
	"context"
	"io"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/openaichat"
)

// GenerateTextStream streams a MediaGo chat-completions text response.
func (provider *Provider) GenerateTextStream(ctx context.Context, request generation.Request) (generation.TextStream, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, generation.ErrMissingPrompt
	}
	adapter, err := provider.resolveRequest(&request)
	if err != nil {
		return nil, err
	}
	if adapter != generation.AdapterMediagoText {
		return nil, generation.ErrTextStreamingUnsupported
	}
	body, err := provider.postStream(ctx, "/chat/completions", textPayload(request))
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
		event, recvErr := stream.Recv()
		if recvErr == io.EOF {
			break
		}
		if recvErr != nil {
			return generation.Response{}, recvErr
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

type textRequest struct {
	Model         string         `json:"model"`
	Messages      []textMessage  `json:"messages"`
	Stream        bool           `json:"stream"`
	StreamOptions map[string]any `json:"stream_options,omitempty"`
	Temperature   *float64       `json:"temperature,omitempty"`
	MaxTokens     *int           `json:"max_tokens,omitempty"`
}

type textMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func textPayload(request generation.Request) textRequest {
	return textRequest{
		Model:         request.Model,
		Messages:      []textMessage{{Role: "user", Content: request.Prompt}},
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
