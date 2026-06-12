package dmx

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

type videoCreateResponse struct {
	ID        string `json:"id"`
	Object    string `json:"object"`
	Model     string `json:"model"`
	CreatedAt int64  `json:"created_at"`
}

type videoStatusResponse struct {
	ID          string         `json:"id"`
	Object      string         `json:"object"`
	Model       string         `json:"model"`
	Status      string         `json:"status"`
	Progress    int            `json:"progress"`
	CreatedAt   int64          `json:"created_at"`
	CompletedAt int64          `json:"completed_at"`
	Metadata    map[string]any `json:"meta_data"`
	VideoURL    string         `json:"video_url"`
}

func (provider *Provider) createVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", valueOrDefault(request.Model, "doubao-seedance-1-0-pro-fast-251015")); err != nil {
		return generation.Response{}, err
	}
	if err := writer.WriteField("prompt", request.Prompt); err != nil {
		return generation.Response{}, err
	}
	if err := writer.Close(); err != nil {
		return generation.Response{}, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+"/v1/videos", &body)
	if err != nil {
		return generation.Response{}, err
	}
	httpRequest.Header.Set("Content-Type", writer.FormDataContentType())
	httpRequest.Header.Set("Authorization", provider.videoAuthorization())

	response, err := provider.do(httpRequest)
	if err != nil {
		return generation.Response{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return generation.Response{}, readHTTPError(response)
	}

	var payload videoCreateResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return generation.Response{}, err
	}

	return generation.Response{
		ID:     payload.ID,
		Status: "submitted",
		Model:  payload.Model,
		Metadata: map[string]any{
			"object":     payload.Object,
			"created_at": payload.CreatedAt,
		},
	}, nil
}

func (response videoStatusResponse) toGenerationResponse() generation.Response {
	assets := []generation.Asset{}
	if response.VideoURL != "" {
		assets = append(assets, generation.Asset{
			Kind: generation.KindVideo,
			URL:  response.VideoURL,
		})
	}

	return generation.Response{
		ID:     response.ID,
		Status: response.Status,
		Model:  response.Model,
		Assets: assets,
		Metadata: map[string]any{
			"object":       response.Object,
			"progress":     response.Progress,
			"created_at":   response.CreatedAt,
			"completed_at": response.CompletedAt,
			"meta_data":    response.Metadata,
		},
	}
}
