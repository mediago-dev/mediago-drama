package dmx

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

type responsesVideoResponse struct {
	ID        string                `json:"id"`
	RequestID string                `json:"request_id"`
	Status    string                `json:"status"`
	Output    []responsesOutputItem `json:"output"`
	Usage     imageResponseUsage    `json:"usage"`
}

type responsesOutputItem struct {
	Type    string                 `json:"type"`
	Content []responsesContentItem `json:"content"`
}

type responsesContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func (provider *Provider) createResponsesVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := map[string]any{
		"model": request.Model,
		"input": []map[string]string{
			{
				"type": "text",
				"text": request.Prompt,
			},
		},
		"ratio":             firstNonEmpty(paramString(request.Params, "ratio"), "16:9"),
		"resolution":        firstNonEmpty(paramString(request.Params, "resolution"), "480p"),
		"duration":          paramInt(request.Params, "duration", 4),
		"generate_audio":    paramBool(request.Params, "generateAudio", false),
		"watermark":         paramBool(request.Params, "watermark", false),
		"return_last_frame": paramBool(request.Params, "returnLastFrame", false),
	}
	if seed := paramIntPointer(request.Params, "seed"); seed != nil {
		payload["seed"] = *seed
	}
	if timeout := paramIntPointer(request.Params, "executionExpiresAfter"); timeout != nil {
		payload["execution_expires_after"] = *timeout
	}

	var payloadResponse responsesVideoResponse
	if err := provider.postJSON(ctx, "/v1/responses", payload, provider.apiKey, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	taskID, inner := payloadResponse.taskID()
	if taskID == "" {
		taskID = payloadResponse.ID
	}
	if taskID == "" {
		return generation.Response{}, fmt.Errorf("dmx video response did not include a task id")
	}

	return generation.Response{
		ID:     joinTaskID(taskIDPrefix(request), taskID),
		Status: "submitted",
		Model:  request.Model,
		Usage:  payloadResponse.usage(),
		Metadata: map[string]any{
			"request_id": payloadResponse.RequestID,
			"task_id":    taskID,
			"result":     inner,
		},
	}, nil
}

func (provider *Provider) getResponsesVideo(
	ctx context.Context,
	route generation.ModelRoute,
	prefix string,
	taskID string,
) (generation.Response, error) {
	queryModel := "seedance-2-0-get"
	auth := provider.videoAuthorization()

	payload := map[string]any{
		"model": queryModel,
		"input": taskID,
	}

	var payloadResponse responsesVideoResponse
	if err := provider.postJSON(ctx, "/v1/responses", payload, auth, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	inner := payloadResponse.firstOutputJSON()
	videoURL := stringFromMap(inner, "video_url")
	watermarkVideoURL := stringFromMap(inner, "watermark_video_url")
	if content, ok := inner["content"].(map[string]any); ok {
		videoURL = firstNonEmpty(videoURL, stringFromMap(content, "video_url"))
		watermarkVideoURL = firstNonEmpty(watermarkVideoURL, stringFromMap(content, "watermark_video_url"))
	}

	assets := []generation.Asset{}
	if videoURL != "" {
		assets = append(assets, generation.Asset{
			Kind: generation.KindVideo,
			URL:  videoURL,
		})
	}

	status := normalizeVideoStatus(firstNonEmpty(
		stringFromMap(inner, "status"),
		stringFromMap(inner, "task_status"),
		payloadResponse.Status,
	))

	return generation.Response{
		ID:     joinTaskID(prefix, taskID),
		Status: firstNonEmpty(status, "submitted"),
		Model:  firstNonEmpty(stringFromMap(inner, "model"), route.Model),
		Assets: assets,
		Usage:  payloadResponse.usage(),
		Metadata: map[string]any{
			"request_id":          payloadResponse.RequestID,
			"task_id":             taskID,
			"result":              inner,
			"watermark_video_url": watermarkVideoURL,
		},
	}, nil
}

func (response responsesVideoResponse) taskID() (string, map[string]any) {
	inner := response.firstOutputJSON()
	if taskID, ok := inner["task_id"].(string); ok {
		return taskID, inner
	}

	return response.ID, inner
}

func (response responsesVideoResponse) firstOutputJSON() map[string]any {
	for _, output := range response.Output {
		for _, content := range output.Content {
			if content.Text == "" {
				continue
			}

			var inner map[string]any
			if err := json.Unmarshal([]byte(content.Text), &inner); err == nil {
				return inner
			}
		}
	}

	return map[string]any{}
}

func (response responsesVideoResponse) usage() generation.Usage {
	return response.Usage.toGenerationUsage()
}
