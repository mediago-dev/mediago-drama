package dmx

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const seedreamMaxImageCount = 4

type seedreamBatchResult struct {
	response generation.Response
	err      error
}

type imageRequest struct {
	Model                            string                            `json:"model"`
	Input                            string                            `json:"input"`
	Size                             string                            `json:"size,omitempty"`
	Image                            []string                          `json:"image,omitempty"`
	SequentialImageGeneration        string                            `json:"sequential_image_generation,omitempty"`
	SequentialImageGenerationOptions *sequentialImageGenerationOptions `json:"sequential_image_generation_options,omitempty"`
	Tools                            []map[string]string               `json:"tools,omitempty"`
	Stream                           bool                              `json:"stream,omitempty"`
	OutputFormat                     string                            `json:"output_format,omitempty"`
	ResponseFormat                   string                            `json:"response_format,omitempty"`
	Watermark                        *bool                             `json:"watermark,omitempty"`
	OptimizePromptOptions            *optimizePromptOptions            `json:"optimize_prompt_options,omitempty"`
}

type sequentialImageGenerationOptions struct {
	MaxImages int `json:"max_images,omitempty"`
}

type optimizePromptOptions struct {
	Mode string `json:"mode,omitempty"`
}

type imageResponse struct {
	ID        string                      `json:"id"`
	Object    string                      `json:"object"`
	CreatedAt int64                       `json:"created_at"`
	Created   int64                       `json:"created"`
	Status    string                      `json:"status"`
	Model     string                      `json:"model"`
	Output    []imageOutputItem           `json:"output"`
	Data      []imagesGenerationsDataItem `json:"data"`
	Usage     imageResponseUsage          `json:"usage"`
}

type imageOutputItem struct {
	Type     string    `json:"type"`
	ImageURL *imageURL `json:"image_url,omitempty"`
	URL      string    `json:"url,omitempty"`
	Content  []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content,omitempty"`
	B64JSON     string `json:"b64_json,omitempty"`
	ImageBase64 string `json:"image_base64,omitempty"`
	Result      string `json:"result,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageCount := boundedSeedreamImageCount(paramInt(request.Params, "n", 1))
	if imageCount > 1 {
		return provider.generateImageBatch(ctx, request, imageCount)
	}

	return provider.generateSingleImage(ctx, request, seedreamMaxImages(request, imageCount))
}

func (provider *Provider) generateImageBatch(
	ctx context.Context,
	request generation.Request,
	imageCount int,
) (generation.Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]seedreamBatchResult, imageCount)
	var waitGroup sync.WaitGroup
	for index := range imageCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()

			singleRequest := request
			singleRequest.Params = cloneSeedreamParams(request.Params)
			singleRequest.Params["n"] = 1

			response, err := provider.generateSingleImage(ctx, singleRequest, 1)
			if err != nil {
				cancel()
			}
			results[index] = seedreamBatchResult{
				response: response,
				err:      err,
			}
		}()
	}
	waitGroup.Wait()

	for _, result := range results {
		if result.err != nil {
			return generation.Response{}, result.err
		}
	}

	return combineSeedreamResponses(request, results), nil
}

func (provider *Provider) generateSingleImage(
	ctx context.Context,
	request generation.Request,
	maxImages int,
) (generation.Response, error) {
	payload := imageRequest{
		Model:          valueOrDefault(request.Model, "doubao-seedream-5.0-lite"),
		Input:          request.Prompt,
		Size:           firstNonEmpty(paramString(request.Params, "size"), "2K"),
		Image:          request.ReferenceURLs,
		OutputFormat:   firstNonEmpty(paramString(request.Params, "outputFormat"), request.OutputFormat, "png"),
		ResponseFormat: valueOrDefault(request.ResponseFormat, "url"),
		Watermark:      boolParamPointer(request.Params, "watermark", request.Watermark, false),
	}
	if len(request.ReferenceURLs) > 0 || maxImages > 1 {
		payload.SequentialImageGeneration = "auto"
		payload.SequentialImageGenerationOptions = &sequentialImageGenerationOptions{
			MaxImages: maxImages,
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return generation.Response{}, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+"/v1/responses", bytes.NewReader(body))
	if err != nil {
		return generation.Response{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", provider.apiKey)

	response, err := provider.do(httpRequest)
	if err != nil {
		return generation.Response{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return generation.Response{}, readHTTPError(response)
	}

	var payloadResponse imageResponse
	if err := json.NewDecoder(response.Body).Decode(&payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(), nil
}

func boundedSeedreamImageCount(value int) int {
	return max(1, min(value, seedreamMaxImageCount))
}

func seedreamMaxImages(request generation.Request, imageCount int) int {
	if len(request.ReferenceURLs) > 0 && imageCount <= 1 {
		return max(1, 15-len(request.ReferenceURLs))
	}

	return min(imageCount, max(1, 15-len(request.ReferenceURLs)))
}

func cloneSeedreamParams(params map[string]any) map[string]any {
	cloned := make(map[string]any, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	return cloned
}

func combineSeedreamResponses(request generation.Request, results []seedreamBatchResult) generation.Response {
	response := generation.Response{
		Status:   "completed",
		Model:    valueOrDefault(request.Model, "doubao-seedream-5.0-lite"),
		Assets:   []generation.Asset{},
		Metadata: map[string]any{"image_count": len(results)},
	}

	for _, result := range results {
		item := result.response
		if response.ID == "" {
			response.ID = item.ID
		}
		if item.Status != "" {
			response.Status = item.Status
		}
		if item.Model != "" {
			response.Model = item.Model
		}
		if response.Metadata["created_at"] == nil && item.Metadata != nil {
			if createdAt, ok := item.Metadata["created_at"]; ok {
				response.Metadata["created_at"] = createdAt
			}
			if object, ok := item.Metadata["object"]; ok {
				response.Metadata["object"] = object
			}
		}
		response.Assets = append(response.Assets, item.Assets...)
		response.Usage = addSeedreamUsage(response.Usage, item.Usage)
	}

	return response
}

func addSeedreamUsage(left generation.Usage, right generation.Usage) generation.Usage {
	return generation.Usage{
		InputTokens:     left.InputTokens + right.InputTokens,
		OutputTokens:    left.OutputTokens + right.OutputTokens,
		TotalTokens:     left.TotalTokens + right.TotalTokens,
		ReasoningTokens: left.ReasoningTokens + right.ReasoningTokens,
		CachedTokens:    left.CachedTokens + right.CachedTokens,
	}
}

func (response imageResponse) toGenerationResponse() generation.Response {
	assets := make([]generation.Asset, 0, len(response.Output)+len(response.Data))
	for _, item := range response.Output {
		if item.ImageURL != nil && item.ImageURL.URL != "" {
			assets = append(assets, generation.Asset{
				Kind: generation.KindImage,
				URL:  item.ImageURL.URL,
			})
			continue
		}
		if item.URL != "" {
			assets = append(assets, generation.Asset{
				Kind: generation.KindImage,
				URL:  item.URL,
			})
			continue
		}
		if item.B64JSON != "" {
			assets = append(assets, generation.Asset{
				Kind:   generation.KindImage,
				Base64: item.B64JSON,
			})
			continue
		}
		if item.ImageBase64 != "" {
			assets = append(assets, generation.Asset{
				Kind:   generation.KindImage,
				Base64: item.ImageBase64,
			})
			continue
		}
		if item.Result != "" {
			assets = append(assets, generation.Asset{
				Kind:   generation.KindImage,
				Base64: item.Result,
			})
			continue
		}
		for _, content := range item.Content {
			if content.Text == "" {
				continue
			}
			assets = append(assets, imageAssetsFromText(content.Text)...)
		}
	}
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
			asset := generation.Asset{
				Kind:   generation.KindImage,
				Base64: item.B64JSON,
			}
			if item.RevisedPrompt != "" {
				asset.Metadata = map[string]any{"revised_prompt": item.RevisedPrompt}
			}
			assets = append(assets, asset)
		}
	}
	status := response.Status
	if status == "" && len(assets) > 0 {
		status = "completed"
	}
	createdAt := response.CreatedAt
	if createdAt == 0 {
		createdAt = response.Created
	}

	return generation.Response{
		ID:     response.ID,
		Status: status,
		Model:  response.Model,
		Assets: assets,
		Usage:  response.Usage.toGenerationUsage(),
		Metadata: map[string]any{
			"object":     response.Object,
			"created_at": createdAt,
		},
	}
}
