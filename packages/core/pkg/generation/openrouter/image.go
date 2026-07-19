package openrouter

import (
	"context"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageConfig := map[string]any{
		"aspect_ratio": firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
		"image_size":   firstNonEmpty(paramString(request.Params, "imageSize"), "1K"),
	}

	payload := chatCompletionRequest{
		Model:       request.Model,
		Messages:    []chatMessage{{Role: "user", Content: messageContent(request.Prompt, request.ReferenceURLs)}},
		Modalities:  []string{"image", "text"},
		Stream:      false,
		ImageConfig: imageConfig,
	}

	var payloadResponse chatCompletionResponse
	if err := provider.postJSON(ctx, "/chat/completions", payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func (provider *Provider) generateImages(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := imagesRequest{
		Model:             request.Model,
		Prompt:            request.Prompt,
		N:                 paramInt(request.Params, "n", 1),
		Size:              paramString(request.Params, "size"),
		Quality:           paramString(request.Params, "quality"),
		OutputFormat:      paramString(request.Params, "outputFormat"),
		OutputCompression: paramIntPointer(request.Params, "outputCompression"),
		Background:        paramString(request.Params, "background"),
		InputReferences:   imageURLObjects(request.ReferenceURLs),
		Provider:          openAIProviderOptions(request.Params),
	}
	var payloadResponse imagesResponse
	if err := provider.postJSON(ctx, "/images", payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model, payload.OutputFormat), nil
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

type imagesRequest struct {
	Model             string           `json:"model"`
	Prompt            string           `json:"prompt"`
	N                 int              `json:"n,omitempty"`
	Size              string           `json:"size,omitempty"`
	Quality           string           `json:"quality,omitempty"`
	OutputFormat      string           `json:"output_format,omitempty"`
	OutputCompression *int             `json:"output_compression,omitempty"`
	Background        string           `json:"background,omitempty"`
	InputReferences   []map[string]any `json:"input_references,omitempty"`
	Provider          map[string]any   `json:"provider,omitempty"`
}

type imagesResponse struct {
	ID      string `json:"id"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Data    []struct {
		URL           string `json:"url"`
		B64JSON       string `json:"b64_json"`
		MediaType     string `json:"media_type"`
		RevisedPrompt string `json:"revised_prompt"`
	} `json:"data"`
	Usage struct {
		PromptTokens     int     `json:"prompt_tokens"`
		CompletionTokens int     `json:"completion_tokens"`
		TotalTokens      int     `json:"total_tokens"`
		Cost             float64 `json:"cost"`
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

func (response imagesResponse) toGenerationResponse(model string, outputFormat string) generation.Response {
	assets := make([]generation.Asset, 0, len(response.Data))
	for _, item := range response.Data {
		if item.URL != "" {
			asset := generation.Asset{
				Kind: generation.KindImage,
				URL:  item.URL,
			}
			if item.RevisedPrompt != "" {
				asset.Metadata = map[string]any{"revised_prompt": item.RevisedPrompt}
			}
			assets = append(assets, asset)
			continue
		}
		if item.B64JSON != "" {
			mimeType := firstNonEmpty(item.MediaType, imageMIMEType(outputFormat))
			asset := generation.Asset{
				Kind:     generation.KindImage,
				Base64:   item.B64JSON,
				MIMEType: mimeType,
			}
			if item.RevisedPrompt != "" {
				asset.Metadata = map[string]any{"revised_prompt": item.RevisedPrompt}
			}
			assets = append(assets, asset)
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
		Metadata: map[string]any{
			"created": response.Created,
			"cost":    response.Usage.Cost,
		},
	}
}

func openAIProviderOptions(params map[string]any) map[string]any {
	moderation := paramString(params, "moderation")
	if moderation == "" {
		return nil
	}

	return map[string]any{
		"options": map[string]any{
			"openai": map[string]any{
				"moderation": moderation,
			},
		},
	}
}

func imageMIMEType(outputFormat string) string {
	switch strings.ToLower(strings.TrimSpace(outputFormat)) {
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}
