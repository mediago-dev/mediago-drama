package official

import (
	"context"
	"encoding/base64"
	"net/url"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

const googleImageMaxImageCount = 4

type googleImageBatchResult struct {
	response generation.Response
	err      error
}

func (provider *Provider) generateGoogleImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageCount := boundedGoogleImageCount(paramInt(request.Params, "n", 1))
	if imageCount > 1 {
		return provider.generateGoogleImageBatch(ctx, request, imageCount)
	}

	return provider.generateSingleGoogleImage(ctx, request)
}

func (provider *Provider) generateGoogleImageBatch(
	ctx context.Context,
	request generation.Request,
	imageCount int,
) (generation.Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]googleImageBatchResult, imageCount)
	var waitGroup sync.WaitGroup
	for index := range imageCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()

			singleRequest := request
			singleRequest.Params = cloneGoogleImageParams(request.Params)
			singleRequest.Params["n"] = 1

			response, err := provider.generateSingleGoogleImage(ctx, singleRequest)
			if err != nil {
				cancel()
			}
			results[index] = googleImageBatchResult{
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

	return combineGoogleImageResponses(request.Model, results), nil
}

func (provider *Provider) generateSingleGoogleImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	parts := []googlePart{{Text: request.Prompt}}
	for _, reference := range compactStrings(request.ReferenceURLs) {
		inlineData, err := provider.googleInlineDataFromReference(ctx, reference)
		if err != nil {
			return generation.Response{}, err
		}
		parts = append(parts, googlePart{InlineData: &inlineData})
	}

	payload := googleGenerateContentRequest{
		Contents: []googleContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
		GenerationConfig: googleGenerationConfig{
			ResponseModalities: []string{"IMAGE"},
			ResponseFormat: googleResponseFormat{
				Image: googleImageResponseFormat{
					AspectRatio: firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
					ImageSize:   firstNonEmpty(paramString(request.Params, "imageSize"), "1K"),
				},
			},
		},
	}

	endpoint := provider.googleBaseURL + "/v1beta/models/" + url.PathEscape(request.Model) + ":generateContent"
	var payloadResponse googleGenerateContentResponse
	if err := provider.postGoogleJSON(ctx, endpoint, payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func boundedGoogleImageCount(value int) int {
	return max(1, min(value, googleImageMaxImageCount))
}

func cloneGoogleImageParams(params map[string]any) map[string]any {
	cloned := make(map[string]any, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	return cloned
}

func combineGoogleImageResponses(model string, results []googleImageBatchResult) generation.Response {
	response := generation.Response{
		Status:   "completed",
		Model:    model,
		Assets:   []generation.Asset{},
		Metadata: map[string]any{"image_count": len(results)},
	}
	texts := []string{}

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
		response.Assets = append(response.Assets, item.Assets...)
		response.Usage = addGoogleImageUsage(response.Usage, item.Usage)
		if itemTexts, ok := item.Metadata["text"].([]string); ok {
			texts = append(texts, itemTexts...)
		}
	}
	if len(texts) > 0 {
		response.Metadata["text"] = texts
	}

	return response
}

func addGoogleImageUsage(left generation.Usage, right generation.Usage) generation.Usage {
	return generation.Usage{
		InputTokens:     left.InputTokens + right.InputTokens,
		OutputTokens:    left.OutputTokens + right.OutputTokens,
		TotalTokens:     left.TotalTokens + right.TotalTokens,
		ReasoningTokens: left.ReasoningTokens + right.ReasoningTokens,
		CachedTokens:    left.CachedTokens + right.CachedTokens,
	}
}

func (provider *Provider) googleInlineDataFromReference(ctx context.Context, reference string) (googleInlineData, error) {
	mimeType, data, err := adapterutil.ReadImageReference(ctx, provider.client, reference, readHTTPError)
	if err != nil {
		return googleInlineData{}, err
	}

	return googleInlineData{
		MIMEType: mimeType,
		Data:     base64.StdEncoding.EncodeToString(data),
	}, nil
}

type googleGenerateContentRequest struct {
	Contents         []googleContent        `json:"contents"`
	GenerationConfig googleGenerationConfig `json:"generationConfig"`
}

type googleContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []googlePart `json:"parts"`
}

type googlePart struct {
	Text            string            `json:"text,omitempty"`
	InlineData      *googleInlineData `json:"inlineData,omitempty"`
	InlineDataSnake *googleInlineData `json:"inline_data,omitempty"`
}

type googleInlineData struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type googleGenerationConfig struct {
	ResponseModalities []string             `json:"responseModalities,omitempty"`
	ResponseFormat     googleResponseFormat `json:"responseFormat,omitempty"`
}

type googleResponseFormat struct {
	Image googleImageResponseFormat `json:"image,omitempty"`
}

type googleImageResponseFormat struct {
	AspectRatio string `json:"aspectRatio,omitempty"`
	ImageSize   string `json:"imageSize,omitempty"`
}

type googleGenerateContentResponse struct {
	Candidates []struct {
		Content googleContent `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func (response googleGenerateContentResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	texts := []string{}
	for _, candidate := range response.Candidates {
		for _, part := range candidate.Content.Parts {
			inlineData := part.InlineData
			if inlineData == nil {
				inlineData = part.InlineDataSnake
			}
			if inlineData != nil && inlineData.Data != "" {
				assets = append(assets, generation.Asset{
					Kind:     generation.KindImage,
					Base64:   inlineData.Data,
					MIMEType: inlineData.MIMEType,
				})
			}
			if part.Text != "" {
				texts = append(texts, part.Text)
			}
		}
	}

	return generation.Response{
		Status: "completed",
		Model:  model,
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  response.UsageMetadata.PromptTokenCount,
			OutputTokens: response.UsageMetadata.CandidatesTokenCount,
			TotalTokens:  response.UsageMetadata.TotalTokenCount,
		},
		Metadata: map[string]any{
			"text": texts,
		},
	}
}
