package openrouter

import (
	"context"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := chatCompletionRequest{
		Model:      request.Model,
		Messages:   []chatMessage{{Role: "user", Content: messageContent(request.Prompt, request.ReferenceURLs)}},
		Modalities: []string{"image", "text"},
		Stream:     false,
		ImageConfig: map[string]any{
			"aspect_ratio": firstNonEmpty(paramString(request.Params, "aspectRatio"), paramString(request.Params, "ratio"), "1:1"),
			"image_size":   firstNonEmpty(paramString(request.Params, "imageSize"), request.Size, "1K"),
		},
	}

	var payloadResponse chatCompletionResponse
	if err := provider.postJSON(ctx, "/chat/completions", payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

type chatCompletionRequest struct {
	Model         string         `json:"model"`
	Messages      []chatMessage  `json:"messages"`
	Modalities    []string       `json:"modalities,omitempty"`
	Stream        bool           `json:"stream"`
	StreamOptions map[string]any `json:"stream_options,omitempty"`
	Temperature   *float64       `json:"temperature,omitempty"`
	MaxTokens     *int           `json:"max_tokens,omitempty"`
	ImageConfig   map[string]any `json:"image_config,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatCompletionResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content any `json:"content"`
			Images  []struct {
				Type     string `json:"type"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (response chatCompletionResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	for _, choice := range response.Choices {
		for _, image := range choice.Message.Images {
			if image.ImageURL.URL == "" {
				continue
			}
			assets = append(assets, generation.Asset{
				Kind: generation.KindImage,
				URL:  image.ImageURL.URL,
			})
		}
	}

	return generation.Response{
		ID:     response.ID,
		Status: "completed",
		Model:  firstNonEmpty(response.Model, model),
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  response.Usage.PromptTokens,
			OutputTokens: response.Usage.CompletionTokens,
			TotalTokens:  response.Usage.TotalTokens,
		},
	}
}
