package dmx

import (
	"context"
	"encoding/base64"
	"net/url"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const geminiMaxImageCount = 4

type geminiBatchResult struct {
	response generation.Response
	err      error
}

type geminiGenerateContentRequest struct {
	Contents         []geminiContent        `json:"contents"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text       string            `json:"text,omitempty"`
	InlineData *geminiInlineData `json:"inlineData,omitempty"`
}

type geminiInlineData struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiGenerationConfig struct {
	ResponseModalities []string          `json:"responseModalities,omitempty"`
	ImageConfig        geminiImageConfig `json:"imageConfig,omitempty"`
}

type geminiImageConfig struct {
	AspectRatio string `json:"aspectRatio,omitempty"`
	ImageSize   string `json:"imageSize,omitempty"`
}

type geminiGenerateContentResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func (provider *Provider) generateGeminiImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageCount := boundedGeminiImageCount(paramInt(request.Params, "n", 1))
	if imageCount > 1 {
		return provider.generateGeminiImageBatch(ctx, request, imageCount)
	}

	return provider.generateSingleGeminiImage(ctx, request)
}

func (provider *Provider) generateGeminiImageBatch(
	ctx context.Context,
	request generation.Request,
	imageCount int,
) (generation.Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]geminiBatchResult, imageCount)
	var waitGroup sync.WaitGroup
	for index := range imageCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()

			singleRequest := request
			singleRequest.Params = cloneGeminiParams(request.Params)
			singleRequest.Params["n"] = 1

			response, err := provider.generateSingleGeminiImage(ctx, singleRequest)
			if err != nil {
				cancel()
			}
			results[index] = geminiBatchResult{
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

	return combineGeminiResponses(request.Model, results), nil
}

func (provider *Provider) generateSingleGeminiImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	parts := []geminiPart{{Text: request.Prompt}}
	for _, reference := range compactStrings(request.ReferenceURLs) {
		inlineData, err := provider.geminiInlineDataFromReference(ctx, reference)
		if err != nil {
			return generation.Response{}, err
		}
		parts = append(parts, geminiPart{InlineData: &inlineData})
	}

	payload := geminiGenerateContentRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
		GenerationConfig: geminiGenerationConfig{
			ResponseModalities: []string{"Image"},
			ImageConfig: geminiImageConfig{
				AspectRatio: firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
				ImageSize:   firstNonEmpty(paramString(request.Params, "imageSize"), request.Size, "1K"),
			},
		},
	}

	endpoint := "/v1beta/models/" + url.PathEscape(request.Model) + ":generateContent"
	var payloadResponse geminiGenerateContentResponse
	if err := provider.postGeminiJSON(ctx, endpoint, payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func boundedGeminiImageCount(value int) int {
	return max(1, min(value, geminiMaxImageCount))
}

func cloneGeminiParams(params map[string]any) map[string]any {
	cloned := make(map[string]any, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	return cloned
}

func combineGeminiResponses(model string, results []geminiBatchResult) generation.Response {
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
		response.Usage = addGeminiUsage(response.Usage, item.Usage)
		if itemTexts, ok := item.Metadata["text"].([]string); ok {
			texts = append(texts, itemTexts...)
		}
	}
	if len(texts) > 0 {
		response.Metadata["text"] = texts
	}

	return response
}

func addGeminiUsage(left generation.Usage, right generation.Usage) generation.Usage {
	return generation.Usage{
		InputTokens:     left.InputTokens + right.InputTokens,
		OutputTokens:    left.OutputTokens + right.OutputTokens,
		TotalTokens:     left.TotalTokens + right.TotalTokens,
		ReasoningTokens: left.ReasoningTokens + right.ReasoningTokens,
		CachedTokens:    left.CachedTokens + right.CachedTokens,
	}
}

func (provider *Provider) geminiInlineDataFromReference(ctx context.Context, reference string) (geminiInlineData, error) {
	mimeType, data, err := provider.imageReferenceData(ctx, reference)
	if err != nil {
		return geminiInlineData{}, err
	}

	return geminiInlineData{
		MIMEType: mimeType,
		Data:     base64.StdEncoding.EncodeToString(data),
	}, nil
}

func (response geminiGenerateContentResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	texts := []string{}
	for _, candidate := range response.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData != nil && part.InlineData.Data != "" {
				assets = append(assets, generation.Asset{
					Kind:     generation.KindImage,
					Base64:   part.InlineData.Data,
					MIMEType: part.InlineData.MIMEType,
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
