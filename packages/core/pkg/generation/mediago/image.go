package mediago

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	imageResultRecoveryHeader     = "Idempotency-Key"
	mediagoChatImageMaxImageCount = 4
)

type mediagoChatImageBatchResult struct {
	response generation.Response
	err      error
}

var (
	imageResultRecoveryInterval = 5 * time.Second
	imageResultRecoveryWindow   = 3 * time.Minute
)

func (provider *Provider) generateChatImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageCount := boundedMediagoChatImageCount(paramInt(request.Params, "n", 1))
	if imageCount > 1 {
		return provider.generateChatImageBatch(ctx, request, imageCount)
	}

	return provider.generateSingleChatImage(ctx, request)
}

func (provider *Provider) generateChatImageBatch(
	ctx context.Context,
	request generation.Request,
	imageCount int,
) (generation.Response, error) {
	results := make([]mediagoChatImageBatchResult, imageCount)
	var waitGroup sync.WaitGroup
	for index := range imageCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()

			singleRequest := request
			singleRequest.Params = cloneMediagoChatImageParams(request.Params)
			singleRequest.Params["n"] = 1

			response, err := provider.generateSingleChatImage(ctx, singleRequest)
			results[index] = mediagoChatImageBatchResult{
				response: response,
				err:      err,
			}
		}()
	}
	waitGroup.Wait()

	if err := ctx.Err(); err != nil {
		return generation.Response{}, err
	}

	successful := make([]mediagoChatImageBatchResult, 0, imageCount)
	failureMessages := make([]string, 0, imageCount)
	var firstFailure error
	for _, result := range results {
		if result.err != nil {
			if firstFailure == nil || errors.Is(firstFailure, context.Canceled) {
				firstFailure = result.err
			}
			failureMessages = append(failureMessages, result.err.Error())
			continue
		}
		if len(result.response.Assets) == 0 {
			emptyResultError := errors.New("MediaGo chat image generation returned no images")
			failureMessages = append(failureMessages, emptyResultError.Error())
			continue
		}
		successful = append(successful, result)
	}

	if len(successful) == 0 {
		if firstFailure != nil {
			return generation.Response{}, firstFailure
		}
		return generation.Response{}, errors.New("MediaGo chat image generation returned no images")
	}

	response := combineMediagoChatImageResponses(request.Model, successful)
	failedCount := imageCount - len(successful)
	response.Metadata["requested_image_count"] = imageCount
	response.Metadata["successful_image_count"] = len(response.Assets)
	response.Metadata["failed_image_count"] = failedCount
	if failedCount > 0 {
		response.Metadata["partial_success"] = true
		response.Metadata["failure_messages"] = failureMessages
		slog.Warn(
			"MediaGo chat image batch partially completed",
			"model", request.Model,
			"requested", imageCount,
			"succeeded", len(response.Assets),
			"failed", failedCount,
			"errors", failureMessages,
		)
	}

	return response, nil
}

func (provider *Provider) generateSingleChatImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageConfig := map[string]any{
		"aspect_ratio": firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
	}
	if !omitChatImageSize(request.Model) {
		imageConfig["image_size"] = firstNonEmpty(paramString(request.Params, "imageSize"), "1K")
	}
	payload := chatImageRequest{
		Model:       request.Model,
		Messages:    []chatImageMessage{{Role: "user", Content: imageMessageContent(request.Prompt, request.ReferenceURLs)}},
		Modalities:  []string{"image", "text"},
		Stream:      false,
		ImageConfig: imageConfig,
	}
	var response chatImageResponse
	if err := provider.postJSON(ctx, "/chat/completions", payload, &response); err != nil {
		return generation.Response{}, err
	}
	return response.toGenerationResponse(request.Model), nil
}

func boundedMediagoChatImageCount(value int) int {
	return max(1, min(value, mediagoChatImageMaxImageCount))
}

func cloneMediagoChatImageParams(params map[string]any) map[string]any {
	cloned := make(map[string]any, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	return cloned
}

func combineMediagoChatImageResponses(model string, results []mediagoChatImageBatchResult) generation.Response {
	response := generation.Response{
		Status:   "completed",
		Model:    model,
		Assets:   []generation.Asset{},
		Metadata: map[string]any{},
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
		response.Assets = append(response.Assets, item.Assets...)
		response.Usage = addMediagoChatImageUsage(response.Usage, item.Usage)
	}
	response.Metadata["image_count"] = len(response.Assets)
	return response
}

func addMediagoChatImageUsage(left generation.Usage, right generation.Usage) generation.Usage {
	return generation.Usage{
		InputTokens:     left.InputTokens + right.InputTokens,
		OutputTokens:    left.OutputTokens + right.OutputTokens,
		TotalTokens:     left.TotalTokens + right.TotalTokens,
		ReasoningTokens: left.ReasoningTokens + right.ReasoningTokens,
		CachedTokens:    left.CachedTokens + right.CachedTokens,
	}
}

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := imagesRequest{
		Model:             request.Model,
		Prompt:            request.Prompt,
		N:                 paramInt(request.Params, "n", 1),
		Size:              paramString(request.Params, "size"),
		Quality:           paramString(request.Params, "quality"),
		OutputFormat:      paramString(request.Params, "outputFormat"),
		OutputCompression: paramIntPointer(request.Params, "outputCompression"),
		Background:        paramString(request.Params, "background"),
		InputReferences:   imageURLObjects(request.ReferenceURLs),
	}

	recoveryKey, _ := newImageRecoveryKey()
	headers := map[string]string{}
	if recoveryKey != "" {
		headers[imageResultRecoveryHeader] = recoveryKey
	}
	var response imagesResponse
	if err := provider.postJSONWithHeaders(ctx, "/images", payload, headers, &response); err != nil {
		recovered, ok := provider.recoverImageResult(ctx, recoveryKey, err)
		if !ok {
			return generation.Response{}, err
		}
		response = recovered
	}
	return response.toGenerationResponse(request.Model, payload.OutputFormat), nil
}

func (provider *Provider) recoverImageResult(ctx context.Context, key string, cause error) (imagesResponse, bool) {
	if key == "" || !isTransportError(cause) {
		return imagesResponse{}, false
	}
	deadline := time.Now().Add(imageResultRecoveryWindow)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return imagesResponse{}, false
		case <-time.After(imageResultRecoveryInterval):
		}
		var recovered imagesResponse
		status, err := provider.getJSONStatus(ctx, "/images/results/"+url.PathEscape(key), &recovered)
		if err != nil {
			if status == http.StatusOK {
				return imagesResponse{}, false
			}
			continue
		}
		switch status {
		case http.StatusOK:
			return recovered, true
		case http.StatusAccepted:
			continue
		default:
			return imagesResponse{}, false
		}
	}
	return imagesResponse{}, false
}

func isTransportError(err error) bool {
	var urlErr *url.Error
	return errors.As(err, &urlErr) || errors.Is(err, context.DeadlineExceeded)
}

func newImageRecoveryKey() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "imgreq_" + hex.EncodeToString(buffer), nil
}

type chatImageRequest struct {
	Model       string             `json:"model"`
	Messages    []chatImageMessage `json:"messages"`
	Modalities  []string           `json:"modalities,omitempty"`
	Stream      bool               `json:"stream"`
	ImageConfig map[string]any     `json:"image_config,omitempty"`
}

type chatImageMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatImageResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Images []struct {
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`
	Usage imageUsage `json:"usage"`
}

type imagesRequest struct {
	Model             string           `json:"model"`
	Prompt            string           `json:"prompt"`
	N                 int              `json:"n,omitempty"`
	Size              string           `json:"size,omitempty"`
	Quality           string           `json:"quality,omitempty"`
	OutputFormat      string           `json:"output_format,omitempty"`
	OutputCompression *int             `json:"output_compression,omitempty"`
	Background        string           `json:"background,omitempty"`
	InputReferences   []map[string]any `json:"input_references,omitempty"`
}

type imagesResponse struct {
	ID      string               `json:"id"`
	Created int64                `json:"created"`
	Model   string               `json:"model"`
	Data    []imagesResponseItem `json:"data"`
	Usage   imageUsage           `json:"usage"`
}

type imagesResponseItem struct {
	URL           string `json:"url"`
	B64JSON       string `json:"b64_json"`
	MediaType     string `json:"media_type"`
	RevisedPrompt string `json:"revised_prompt"`
}

type imageUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	Cost             float64 `json:"cost"`
}

func (response chatImageResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	for _, choice := range response.Choices {
		for _, image := range choice.Message.Images {
			if image.ImageURL.URL == "" {
				continue
			}
			assets = append(assets, generation.Asset{Kind: generation.KindImage, URL: image.ImageURL.URL})
		}
	}
	return generation.Response{
		ID:     response.ID,
		Status: "completed",
		Model:  firstNonEmpty(response.Model, model),
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  response.Usage.PromptTokens,
			OutputTokens: response.Usage.CompletionTokens,
			TotalTokens:  response.Usage.TotalTokens,
		},
	}
}

func (response imagesResponse) toGenerationResponse(model string, outputFormat string) generation.Response {
	assets := make([]generation.Asset, 0, len(response.Data))
	for _, item := range response.Data {
		asset := generation.Asset{Kind: generation.KindImage}
		switch {
		case item.URL != "":
			asset.URL = item.URL
		case item.B64JSON != "":
			asset.Base64 = item.B64JSON
			asset.MIMEType = firstNonEmpty(item.MediaType, imageMIMEType(outputFormat))
		default:
			continue
		}
		if item.RevisedPrompt != "" {
			asset.Metadata = map[string]any{"revised_prompt": item.RevisedPrompt}
		}
		assets = append(assets, asset)
	}
	return generation.Response{
		ID:     response.ID,
		Status: "completed",
		Model:  firstNonEmpty(response.Model, model),
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  response.Usage.PromptTokens,
			OutputTokens: response.Usage.CompletionTokens,
			TotalTokens:  response.Usage.TotalTokens,
		},
		Metadata: map[string]any{
			"created": response.Created,
			"cost":    response.Usage.Cost,
		},
	}
}

func imageMessageContent(prompt string, referenceURLs []string) any {
	if len(compactStrings(referenceURLs)) == 0 {
		return prompt
	}
	parts := []map[string]any{{"type": "text", "text": prompt}}
	return append(parts, imageURLObjects(referenceURLs)...)
}

func imageURLObjects(referenceURLs []string) []map[string]any {
	parts := make([]map[string]any, 0, len(referenceURLs))
	for _, referenceURL := range compactStrings(referenceURLs) {
		parts = append(parts, map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": referenceURL},
		})
	}
	return parts
}

func omitChatImageSize(model string) bool {
	normalized := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(normalized, "gemini-2.5-flash-image")
}

func imageMIMEType(outputFormat string) string {
	switch strings.ToLower(strings.TrimSpace(outputFormat)) {
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}
