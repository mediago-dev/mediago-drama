package openrouter

import (
	"context"
	"fmt"
	"net/url"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

// Get fetches video task status by id.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	if id == "" {
		return generation.Response{}, fmt.Errorf("generation id is required")
	}

	prefix, taskID := splitTaskID(id)
	endpoint := "/videos/" + url.PathEscape(taskID)

	var payload videoResponse
	if err := provider.getJSON(ctx, endpoint, &payload); err != nil {
		return generation.Response{}, err
	}

	return payload.toGenerationResponse(prefix), nil
}

func (provider *Provider) createVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := map[string]any{
		"model":          request.Model,
		"prompt":         request.Prompt,
		"duration":       paramInt(request.Params, "duration", 3),
		"resolution":     firstNonEmpty(paramString(request.Params, "resolution"), "480p"),
		"aspect_ratio":   firstNonEmpty(paramString(request.Params, "aspectRatio"), paramString(request.Params, "ratio"), "16:9"),
		"generate_audio": false,
	}
	if size := firstNonEmpty(paramString(request.Params, "size"), request.Size); size != "" {
		payload["size"] = size
	}
	if value, ok := paramBoolValue(request.Params, "generateAudio"); ok {
		payload["generate_audio"] = value
	}
	if negativePrompt := paramString(request.Params, "negativePrompt"); negativePrompt != "" {
		payload["negative_prompt"] = negativePrompt
	}
	if len(request.ReferenceURLs) > 0 {
		payload["input_references"] = imageURLObjects(request.ReferenceURLs)
	}

	var payloadResponse videoResponse
	if err := provider.postJSON(ctx, "/video/generations", payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(taskIDPrefix(request)), nil
}

type videoResponse struct {
	ID           string         `json:"id"`
	GenerationID string         `json:"generation_id"`
	PollingURL   string         `json:"polling_url"`
	Status       string         `json:"status"`
	Model        string         `json:"model"`
	UnsignedURLs []string       `json:"unsigned_urls"`
	Error        string         `json:"error"`
	Usage        map[string]any `json:"usage"`
}

func (response videoResponse) toGenerationResponse(prefix string) generation.Response {
	assets := make([]generation.Asset, 0, len(response.UnsignedURLs))
	for _, videoURL := range response.UnsignedURLs {
		if videoURL == "" {
			continue
		}
		assets = append(assets, generation.Asset{
			Kind: generation.KindVideo,
			URL:  videoURL,
		})
	}

	return generation.Response{
		ID:     joinTaskID(prefix, response.ID),
		Status: normalizeVideoStatus(response.Status),
		Model:  response.Model,
		Assets: assets,
		Metadata: map[string]any{
			"generation_id": response.GenerationID,
			"polling_url":   response.PollingURL,
			"error":         response.Error,
			"usage":         response.Usage,
		},
	}
}
