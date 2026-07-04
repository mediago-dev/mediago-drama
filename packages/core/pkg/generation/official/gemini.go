package official

import (
	"context"
	"encoding/base64"
	"strings"
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
	input := []googleInteractionInput{{Type: "text", Text: request.Prompt}}
	for _, reference := range compactStrings(request.ReferenceURLs) {
		inlineData, err := provider.googleInlineDataFromReference(ctx, reference)
		if err != nil {
			return generation.Response{}, err
		}
		input = append(input, googleInteractionInput{
			Type:     "image",
			Data:     inlineData.Data,
			MIMEType: inlineData.MIMEType,
		})
	}

	payload := googleInteractionRequest{
		Model: googleInteractionModelName(request.Model),
		Input: input,
		ResponseFormat: googleInteractionResponseFormat{
			Type:        "image",
			MIMEType:    "image/jpeg",
			AspectRatio: firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
			ImageSize:   googleImageSize(request),
		},
	}

	endpoint := provider.googleBaseURL + "/v1beta/interactions"
	var payloadResponse googleInteractionResponse
	if err := provider.postGoogleJSON(ctx, endpoint, payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func boundedGoogleImageCount(value int) int {
	return max(1, min(value, googleImageMaxImageCount))
}

func googleImageSize(request generation.Request) string {
	imageSize := paramString(request.Params, "imageSize")
	if strings.TrimPrefix(request.Model, "models/") == generation.VersionNanoBanana25 {
		return ""
	}
	return firstNonEmpty(imageSize, "1K")
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

func googleInteractionModelName(model string) string {
	if strings.HasPrefix(model, "models/") {
		return model
	}
	return "models/" + model
}

type googleInteractionRequest struct {
	Model          string                          `json:"model"`
	Input          []googleInteractionInput        `json:"input"`
	ResponseFormat googleInteractionResponseFormat `json:"response_format,omitempty"`
}

type googleInteractionInput struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MIMEType string `json:"mime_type,omitempty"`
}

type googleInteractionResponseFormat struct {
	Type        string `json:"type,omitempty"`
	MIMEType    string `json:"mime_type,omitempty"`
	AspectRatio string `json:"aspect_ratio,omitempty"`
	ImageSize   string `json:"image_size,omitempty"`
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

type googleInteractionResponse struct {
	ID             string                           `json:"id,omitempty"`
	OutputImage    *googleInteractionOutputImage    `json:"output_image,omitempty"`
	OutputText     string                           `json:"output_text,omitempty"`
	Output         []googleInteractionOutputItem    `json:"output,omitempty"`
	Steps          []googleInteractionStep          `json:"steps,omitempty"`
	Candidates     []googleGenerateContentCandidate `json:"candidates,omitempty"`
	UsageMetadata  googleInteractionUsageMetadata   `json:"usage_metadata,omitempty"`
	UsageMetadataC googleInteractionUsageMetadata   `json:"usageMetadata,omitempty"`
}

type googleGenerateContentCandidate struct {
	Content googleContent `json:"content"`
}

type googleInteractionOutputItem struct {
	Type        string                        `json:"type,omitempty"`
	Text        string                        `json:"text,omitempty"`
	Data        string                        `json:"data,omitempty"`
	URI         string                        `json:"uri,omitempty"`
	MIMEType    string                        `json:"mime_type,omitempty"`
	Image       *googleInteractionOutputImage `json:"image,omitempty"`
	OutputImage *googleInteractionOutputImage `json:"output_image,omitempty"`
}

type googleInteractionStep struct {
	Type    string                        `json:"type,omitempty"`
	Content []googleInteractionOutputItem `json:"content,omitempty"`
}

type googleInteractionOutputImage struct {
	Data      string `json:"data,omitempty"`
	Base64    string `json:"base64,omitempty"`
	URI       string `json:"uri,omitempty"`
	MIMEType  string `json:"mime_type,omitempty"`
	MIMETypeC string `json:"mimeType,omitempty"`
}

type googleInteractionUsageMetadata struct {
	InputTokenCount      int `json:"input_token_count,omitempty"`
	OutputTokenCount     int `json:"output_token_count,omitempty"`
	PromptTokenCount     int `json:"promptTokenCount,omitempty"`
	CandidatesTokenCount int `json:"candidatesTokenCount,omitempty"`
	TotalTokenCount      int `json:"total_token_count,omitempty"`
	TotalTokenCountC     int `json:"totalTokenCount,omitempty"`
}

func (response googleInteractionResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	texts := []string{}

	appendImage := func(image *googleInteractionOutputImage) {
		if image == nil {
			return
		}
		data := firstNonEmpty(image.Data, image.Base64)
		uri := strings.TrimSpace(image.URI)
		if data == "" && uri == "" {
			return
		}
		asset := generation.Asset{
			Kind:     generation.KindImage,
			MIMEType: firstNonEmpty(image.MIMEType, image.MIMETypeC, "image/jpeg"),
		}
		if data != "" {
			asset.Base64 = data
		} else {
			asset.URL = uri
		}
		assets = append(assets, asset)
	}
	appendOutputItem := func(item googleInteractionOutputItem) {
		if item.Text != "" {
			texts = append(texts, item.Text)
		}
		if item.Data != "" || strings.TrimSpace(item.URI) != "" {
			appendImage(&googleInteractionOutputImage{
				Data:     item.Data,
				URI:      item.URI,
				MIMEType: item.MIMEType,
			})
		}
		appendImage(item.Image)
		appendImage(item.OutputImage)
	}
	appendImage(response.OutputImage)
	if response.OutputText != "" {
		texts = append(texts, response.OutputText)
	}
	for _, item := range response.Output {
		appendOutputItem(item)
	}
	for _, step := range response.Steps {
		if step.Type != "" && step.Type != "model_output" {
			continue
		}
		for _, item := range step.Content {
			appendOutputItem(item)
		}
	}
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

	usage := response.UsageMetadata
	if usage.isZero() {
		usage = response.UsageMetadataC
	}

	return generation.Response{
		ID:     response.ID,
		Status: "completed",
		Model:  model,
		Assets: assets,
		Usage:  usage.toGenerationUsage(),
		Metadata: map[string]any{
			"text": texts,
		},
	}
}

func (usage googleInteractionUsageMetadata) isZero() bool {
	return usage.InputTokenCount == 0 &&
		usage.OutputTokenCount == 0 &&
		usage.PromptTokenCount == 0 &&
		usage.CandidatesTokenCount == 0 &&
		usage.TotalTokenCount == 0 &&
		usage.TotalTokenCountC == 0
}

func (usage googleInteractionUsageMetadata) toGenerationUsage() generation.Usage {
	inputTokens := usage.InputTokenCount
	if inputTokens == 0 {
		inputTokens = usage.PromptTokenCount
	}
	outputTokens := usage.OutputTokenCount
	if outputTokens == 0 {
		outputTokens = usage.CandidatesTokenCount
	}
	totalTokens := usage.TotalTokenCount
	if totalTokens == 0 {
		totalTokens = usage.TotalTokenCountC
	}
	return generation.Usage{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  totalTokens,
	}
}
