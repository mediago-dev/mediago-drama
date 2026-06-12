package official

import (
	"context"
	"fmt"
	"net/url"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

func (provider *Provider) generateVolcengineImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := volcengineImagesRequest{
		Model:          request.Model,
		Prompt:         request.Prompt,
		Size:           firstNonEmpty(paramString(request.Params, "size"), request.Size, "2K"),
		OutputFormat:   firstNonEmpty(paramString(request.Params, "outputFormat"), request.OutputFormat, "png"),
		ResponseFormat: firstNonEmpty(request.ResponseFormat, "url"),
		Watermark:      boolParamPointer(request.Params, "watermark", request.Watermark, false),
	}
	if len(request.ReferenceURLs) == 1 {
		payload.Image = request.ReferenceURLs[0]
		payload.SequentialImageGeneration = "disabled"
	}
	if len(request.ReferenceURLs) > 1 {
		payload.Image = request.ReferenceURLs
		payload.SequentialImageGeneration = "disabled"
	}

	var payloadResponse openAIImagesResponse
	endpoint := provider.volcengineBaseURL + "/images/generations"
	if err := provider.postJSON(ctx, endpoint, provider.bearerAuthorization(), payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model, payload.OutputFormat), nil
}

func (provider *Provider) createVolcengineVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	content := []map[string]any{
		{
			"type": "text",
			"text": request.Prompt,
		},
	}
	for _, referenceURL := range compactStrings(request.ReferenceURLs) {
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]any{
				"url": referenceURL,
			},
			"role": "reference_image",
		})
	}

	payload := map[string]any{
		"model":          request.Model,
		"content":        content,
		"generate_audio": paramBool(request.Params, "generateAudio", false),
		"ratio":          firstNonEmpty(paramString(request.Params, "ratio"), "16:9"),
		"resolution":     firstNonEmpty(paramString(request.Params, "resolution"), "480p"),
		"duration":       paramInt(request.Params, "duration", 4),
		"watermark":      boolParamValue(request.Params, "watermark", request.Watermark, false),
	}
	if seed := paramIntPointer(request.Params, "seed"); seed != nil {
		payload["seed"] = *seed
	}
	if timeout := paramIntPointer(request.Params, "executionExpiresAfter"); timeout != nil {
		payload["execution_expires_after"] = *timeout
	}
	if value, ok := paramBoolValueOnly(request.Params, "returnLastFrame"); ok {
		payload["return_last_frame"] = value
	}
	if negativePrompt := paramString(request.Params, "negativePrompt"); negativePrompt != "" {
		payload["negative_prompt"] = negativePrompt
	}

	var payloadResponse volcengineVideoCreateResponse
	endpoint := provider.volcengineBaseURL + "/contents/generations/tasks"
	if err := provider.postJSON(ctx, endpoint, provider.bearerAuthorization(), payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}
	if payloadResponse.ID == "" {
		return generation.Response{}, fmt.Errorf("volcengine response did not include a task id")
	}

	return generation.Response{
		ID:     joinTaskID(taskIDPrefix(request), payloadResponse.ID),
		Status: "submitted",
		Model:  request.Model,
		Metadata: map[string]any{
			"task_id": payloadResponse.ID,
		},
	}, nil
}

func (provider *Provider) getVolcengineVideo(ctx context.Context, route generation.ModelRoute, taskID string) (generation.Response, error) {
	var statusResponse volcengineVideoStatusResponse
	endpoint := provider.volcengineBaseURL + "/contents/generations/tasks/" + url.PathEscape(taskID)
	if err := provider.getJSON(ctx, endpoint, provider.bearerAuthorization(), &statusResponse); err != nil {
		return generation.Response{}, err
	}

	assets := []generation.Asset{}
	if statusResponse.Content.VideoURL != "" {
		assets = append(assets, generation.Asset{
			Kind: generation.KindVideo,
			URL:  statusResponse.Content.VideoURL,
		})
	}

	return generation.Response{
		ID:     joinTaskID(route.ID, taskID),
		Status: firstNonEmpty(normalizeVideoStatus(statusResponse.Status), "submitted"),
		Model:  firstNonEmpty(statusResponse.Model, route.Model),
		Assets: assets,
		Usage:  statusResponse.Usage.toGenerationUsage(),
		Metadata: map[string]any{
			"task_id":                 taskID,
			"error":                   statusResponse.Error,
			"created_at":              statusResponse.CreatedAt,
			"updated_at":              statusResponse.UpdatedAt,
			"last_frame_url":          statusResponse.Content.LastFrameURL,
			"seed":                    statusResponse.Seed,
			"resolution":              statusResponse.Resolution,
			"ratio":                   statusResponse.Ratio,
			"duration":                statusResponse.Duration,
			"frames":                  statusResponse.Frames,
			"framespersecond":         statusResponse.FramesPerSecond,
			"generate_audio":          statusResponse.GenerateAudio,
			"draft":                   statusResponse.Draft,
			"service_tier":            statusResponse.ServiceTier,
			"execution_expires_after": statusResponse.ExecutionExpiresAfter,
		},
	}, nil
}

type volcengineImagesRequest struct {
	Model                            string `json:"model"`
	Prompt                           string `json:"prompt"`
	Image                            any    `json:"image,omitempty"`
	Size                             string `json:"size,omitempty"`
	OutputFormat                     string `json:"output_format,omitempty"`
	ResponseFormat                   string `json:"response_format,omitempty"`
	Watermark                        *bool  `json:"watermark,omitempty"`
	SequentialImageGeneration        string `json:"sequential_image_generation,omitempty"`
	SequentialImageGenerationOptions any    `json:"sequential_image_generation_options,omitempty"`
}

type volcengineVideoCreateResponse struct {
	ID string `json:"id"`
}

type volcengineVideoStatusResponse struct {
	ID      string         `json:"id"`
	Model   string         `json:"model"`
	Status  string         `json:"status"`
	Error   map[string]any `json:"error"`
	Content struct {
		VideoURL     string `json:"video_url"`
		LastFrameURL string `json:"last_frame_url"`
	} `json:"content"`
	Usage                 tokenUsage `json:"usage"`
	CreatedAt             int64      `json:"created_at"`
	UpdatedAt             int64      `json:"updated_at"`
	Seed                  int        `json:"seed"`
	Resolution            string     `json:"resolution"`
	Ratio                 string     `json:"ratio"`
	Duration              int        `json:"duration"`
	Frames                int        `json:"frames"`
	FramesPerSecond       int        `json:"framespersecond"`
	GenerateAudio         bool       `json:"generate_audio"`
	Draft                 bool       `json:"draft"`
	ServiceTier           string     `json:"service_tier"`
	ExecutionExpiresAfter int        `json:"execution_expires_after"`
}
