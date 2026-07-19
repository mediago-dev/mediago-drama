package mediago

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

// createVideo submits a HappyHorse text-to-video or reference-to-video task.
func (provider *Provider) createVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	references := compactStrings(request.ReferenceURLs)
	model := generation.ModelHappyHorse11T2V
	if len(references) > 0 {
		model = generation.ModelHappyHorse11R2V
	}
	payload := videoRequest{
		Model:           model,
		Prompt:          request.Prompt,
		AspectRatio:     paramString(request.Params, "aspectRatio"),
		Resolution:      paramString(request.Params, "resolution"),
		Duration:        paramInt(request.Params, "duration", 5),
		InputReferences: videoReferences(references),
	}
	var response videoResponse
	if err := provider.postJSON(ctx, "/videos", payload, &response); err != nil {
		return generation.Response{}, err
	}
	if response.Model == "" {
		response.Model = model
	}
	return response.toGenerationResponse(taskIDPrefix(request)), nil
}

// Get fetches a MediaGo asynchronous video task.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	prefix, taskID := adapterutil.SplitTaskID(strings.TrimSpace(id))
	if prefix == "" || taskID == "" {
		return generation.Response{}, fmt.Errorf("MediaGo generation task id is invalid")
	}
	route, ok := generation.FindRouteByTaskPrefix(prefix)
	if !ok || route.Provider != generation.ProviderMediago || route.Adapter != generation.AdapterMediagoVideo {
		return generation.Response{}, fmt.Errorf("unknown MediaGo video task route %q", prefix)
	}
	var response videoResponse
	if err := provider.getJSON(ctx, "/videos/"+url.PathEscape(taskID), &response); err != nil {
		return generation.Response{}, err
	}
	return response.toGenerationResponse(prefix), nil
}

type videoRequest struct {
	Model           string           `json:"model"`
	Prompt          string           `json:"prompt"`
	AspectRatio     string           `json:"aspect_ratio,omitempty"`
	Resolution      string           `json:"resolution,omitempty"`
	Duration        int              `json:"duration,omitempty"`
	InputReferences []videoReference `json:"input_references,omitempty"`
}

type videoReference struct {
	Type string `json:"type"`
	URL  string `json:"url"`
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
	for _, value := range compactStrings(response.UnsignedURLs) {
		assets = append(assets, generation.Asset{Kind: generation.KindVideo, URL: value})
	}
	return generation.Response{
		ID:     adapterutil.JoinTaskID(prefix, response.ID),
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

func videoReferences(values []string) []videoReference {
	result := make([]videoReference, 0, len(values))
	for _, value := range values {
		result = append(result, videoReference{Type: "image", URL: value})
	}
	return result
}

func normalizeVideoStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "queued", "pending", "submitted":
		return "pending"
	case "processing", "running", "in_progress":
		return "running"
	case "completed", "succeeded", "success":
		return "completed"
	case "cancelled", "canceled":
		return "cancelled"
	case "failed", "error":
		return "failed"
	default:
		return status
	}
}
