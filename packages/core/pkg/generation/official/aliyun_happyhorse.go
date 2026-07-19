package official

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	aliyunHappyHorseGenerationPath = "/api/v1/services/aigc/video-generation/video-synthesis"
	aliyunHappyHorseTaskPath       = "/api/v1/tasks/"
)

var aliyunHappyHorseReferencePattern = regexp.MustCompile(`(?i)@(图片|image)\s*(\d+)`)

type aliyunHappyHorseRequest struct {
	Model      string                     `json:"model"`
	Input      aliyunHappyHorseInput      `json:"input"`
	Parameters aliyunHappyHorseParameters `json:"parameters"`
}

type aliyunHappyHorseInput struct {
	Prompt string                  `json:"prompt"`
	Media  []aliyunHappyHorseMedia `json:"media,omitempty"`
}

type aliyunHappyHorseMedia struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type aliyunHappyHorseParameters struct {
	Resolution string `json:"resolution"`
	Ratio      string `json:"ratio,omitempty"`
	Duration   int    `json:"duration"`
	Watermark  bool   `json:"watermark"`
}

type aliyunHappyHorseResponse struct {
	RequestID string                        `json:"request_id"`
	Code      string                        `json:"code"`
	Message   string                        `json:"message"`
	Output    aliyunHappyHorseTaskOutput    `json:"output"`
	Usage     aliyunHappyHorseResponseUsage `json:"usage"`
}

type aliyunHappyHorseTaskOutput struct {
	TaskID     string `json:"task_id"`
	TaskStatus string `json:"task_status"`
	VideoURL   string `json:"video_url"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

type aliyunHappyHorseResponseUsage struct {
	Duration            int    `json:"duration"`
	InputVideoDuration  int    `json:"input_video_duration"`
	OutputVideoDuration int    `json:"output_video_duration"`
	VideoCount          int    `json:"video_count"`
	Resolution          int    `json:"SR"`
	Ratio               string `json:"ratio"`
}

func (provider *Provider) createAliyunHappyHorseVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	if err := validateAliyunHappyHorseRequest(request); err != nil {
		return generation.Response{}, err
	}

	result := aliyunHappyHorseResponse{}
	if err := provider.postAliyunHappyHorseJSON(ctx, aliyunHappyHorsePayload(request), &result); err != nil {
		return generation.Response{}, err
	}
	if err := aliyunHappyHorseResponseError(result.Code, result.Message); err != nil {
		return generation.Response{}, err
	}
	if strings.TrimSpace(result.Output.TaskID) == "" {
		return generation.Response{}, fmt.Errorf("aliyun HappyHorse response did not include a task id")
	}

	return generation.Response{
		ID:     joinTaskID(taskIDPrefix(request), result.Output.TaskID),
		Status: firstNonEmpty(normalizeVideoStatus(result.Output.TaskStatus), "submitted"),
		Model:  request.Model,
		Metadata: map[string]any{
			"task_id":        result.Output.TaskID,
			"request_id":     result.RequestID,
			"upstream_model": aliyunHappyHorseUpstreamModel(request),
		},
	}, nil
}

func (provider *Provider) getAliyunHappyHorseVideo(ctx context.Context, route generation.ModelRoute, taskID string) (generation.Response, error) {
	result := aliyunHappyHorseResponse{}
	endpoint := provider.aliyunBaseURL + aliyunHappyHorseTaskPath + url.PathEscape(taskID)
	if err := provider.getJSON(ctx, endpoint, provider.bearerAuthorization(), &result); err != nil {
		return generation.Response{}, err
	}
	if err := aliyunHappyHorseResponseError(result.Code, result.Message); err != nil {
		return generation.Response{}, err
	}

	status := normalizeVideoStatus(result.Output.TaskStatus)
	if strings.EqualFold(strings.TrimSpace(result.Output.TaskStatus), "UNKNOWN") {
		status = "failed"
	}
	assets := []generation.Asset{}
	if videoURL := strings.TrimSpace(result.Output.VideoURL); videoURL != "" {
		assets = append(assets, generation.Asset{Kind: generation.KindVideo, URL: videoURL})
	}

	return generation.Response{
		ID:     joinTaskID(route.ID, taskID),
		Status: firstNonEmpty(status, "submitted"),
		Model:  route.Model,
		Assets: assets,
		Metadata: map[string]any{
			"task_id":               taskID,
			"request_id":            result.RequestID,
			"error":                 result.Output.Message,
			"error_code":            result.Output.Code,
			"duration":              result.Usage.Duration,
			"input_video_duration":  result.Usage.InputVideoDuration,
			"output_video_duration": result.Usage.OutputVideoDuration,
			"video_count":           result.Usage.VideoCount,
			"resolution":            result.Usage.Resolution,
			"ratio":                 result.Usage.Ratio,
		},
	}, nil
}

func (provider *Provider) postAliyunHappyHorseJSON(ctx context.Context, payload aliyunHappyHorseRequest, result *aliyunHappyHorseResponse) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		provider.aliyunBaseURL+aliyunHappyHorseGenerationPath,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", provider.bearerAuthorization())
	request.Header.Set("X-DashScope-Async", "enable")

	return provider.doJSON(request, result)
}

func aliyunHappyHorsePayload(request generation.Request) aliyunHappyHorseRequest {
	references := compactStrings(request.ReferenceURLs)
	media := make([]aliyunHappyHorseMedia, 0, len(references))
	for _, referenceURL := range references {
		media = append(media, aliyunHappyHorseMedia{Type: "reference_image", URL: referenceURL})
	}

	parameters := aliyunHappyHorseParameters{
		Resolution: firstNonEmpty(paramString(request.Params, "resolution"), "720P"),
		Duration:   paramInt(request.Params, "duration", 5),
		Watermark:  false,
	}
	parameters.Ratio = firstNonEmpty(paramString(request.Params, "ratio"), "16:9")

	prompt := request.Prompt
	if len(references) > 0 {
		prompt = aliyunHappyHorseReferencePrompt(prompt)
	}

	return aliyunHappyHorseRequest{
		Model: aliyunHappyHorseUpstreamModel(request),
		Input: aliyunHappyHorseInput{
			Prompt: prompt,
			Media:  media,
		},
		Parameters: parameters,
	}
}

func validateAliyunHappyHorseRequest(request generation.Request) error {
	if request.Model != generation.ModelHappyHorse11 {
		return fmt.Errorf("unsupported aliyun HappyHorse video model %q", request.Model)
	}

	referenceCount := len(compactStrings(request.ReferenceURLs))
	if referenceCount > 9 {
		return fmt.Errorf("aliyun HappyHorse video generation supports at most 9 reference images")
	}

	resolution := firstNonEmpty(paramString(request.Params, "resolution"), "720P")
	if resolution != "720P" && resolution != "1080P" {
		return fmt.Errorf("aliyun HappyHorse resolution must be 720P or 1080P")
	}
	duration := paramInt(request.Params, "duration", 5)
	if duration < 3 || duration > 15 {
		return fmt.Errorf("aliyun HappyHorse duration must be between 3 and 15 seconds")
	}

	return nil
}

func aliyunHappyHorseUpstreamModel(request generation.Request) string {
	if len(compactStrings(request.ReferenceURLs)) > 0 {
		return generation.ModelHappyHorse11R2V
	}
	return generation.ModelHappyHorse11T2V
}

func aliyunHappyHorseReferencePrompt(prompt string) string {
	return aliyunHappyHorseReferencePattern.ReplaceAllString(prompt, "[Image $2]")
}

func aliyunHappyHorseResponseError(code string, message string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil
	}
	message = firstNonEmpty(strings.TrimSpace(message), "provider returned a non-success status")
	return fmt.Errorf("aliyun HappyHorse video generation failed (%s): %s", code, message)
}
