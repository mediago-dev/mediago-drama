package official

import (
	"context"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func (provider *Provider) generateOpenAIImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := openAIImagesRequest{
		Model:             request.Model,
		Prompt:            request.Prompt,
		N:                 paramInt(request.Params, "n", 1),
		Size:              firstNonEmpty(paramString(request.Params, "size"), "1024x1024"),
		Quality:           paramString(request.Params, "quality"),
		OutputFormat:      firstNonEmpty(paramString(request.Params, "outputFormat"), request.OutputFormat),
		OutputCompression: paramIntPointer(request.Params, "outputCompression"),
		Background:        paramString(request.Params, "background"),
		Moderation:        paramString(request.Params, "moderation"),
	}

	var payloadResponse openAIImagesResponse
	if err := provider.postJSON(ctx, provider.openAIBaseURL+"/v1/images/generations", provider.bearerAuthorization(), payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model, payload.OutputFormat), nil
}

type openAIImagesRequest struct {
	Model             string `json:"model"`
	Prompt            string `json:"prompt"`
	N                 int    `json:"n,omitempty"`
	Size              string `json:"size,omitempty"`
	Quality           string `json:"quality,omitempty"`
	OutputFormat      string `json:"output_format,omitempty"`
	OutputCompression *int   `json:"output_compression,omitempty"`
	Background        string `json:"background,omitempty"`
	Moderation        string `json:"moderation,omitempty"`
}

type openAIImagesResponse struct {
	Created int64 `json:"created"`
	Data    []struct {
		URL           string `json:"url"`
		B64JSON       string `json:"b64_json"`
		RevisedPrompt string `json:"revised_prompt"`
	} `json:"data"`
	Usage tokenUsage `json:"usage"`
}

func (response openAIImagesResponse) toGenerationResponse(model string, outputFormat string) generation.Response {
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
			assets = append(assets, generation.Asset{
				Kind:     generation.KindImage,
				Base64:   item.B64JSON,
				MIMEType: imageMIMEType(outputFormat),
			})
		}
	}

	return generation.Response{
		Status: "completed",
		Model:  model,
		Assets: assets,
		Usage:  response.Usage.toGenerationUsage(),
		Metadata: map[string]any{
			"created": response.Created,
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
