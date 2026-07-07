package openrouter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/mediago"
)

const imageResultRecoveryHeader = "Idempotency-Key"

// Overridable in tests; production values tolerate multi-minute generations.
var (
	imageResultRecoveryInterval = 5 * time.Second
	imageResultRecoveryWindow   = 3 * time.Minute
)

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	imageConfig := map[string]any{
		"aspect_ratio": firstNonEmpty(paramString(request.Params, "aspectRatio"), "1:1"),
	}
	if !provider.omitChatImageSize(request) {
		imageConfig["image_size"] = firstNonEmpty(paramString(request.Params, "imageSize"), "1K")
	}

	payload := chatCompletionRequest{
		Model:       request.Model,
		Messages:    []chatMessage{{Role: "user", Content: messageContent(request.Prompt, request.ReferenceURLs)}},
		Modalities:  []string{"image", "text"},
		Stream:      false,
		ImageConfig: imageConfig,
	}

	var payloadResponse chatCompletionResponse
	if err := provider.postJSON(ctx, "/chat/completions", payload, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func (provider *Provider) generateImages(ctx context.Context, request generation.Request) (generation.Response, error) {
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
		Provider:          provider.imageProviderOptions(request.Params),
	}

	recoveryKey := ""
	var headers map[string]string
	if mediago.SupportsImageResultRecovery(provider.providerName) {
		if key, err := newImageRecoveryKey(); err == nil {
			recoveryKey = key
			headers = map[string]string{imageResultRecoveryHeader: key}
		}
	}

	var payloadResponse imagesResponse
	if err := provider.postJSONWithHeaders(ctx, "/images", payload, headers, &payloadResponse); err != nil {
		recovered, ok := provider.recoverImagesResult(ctx, recoveryKey, err)
		if !ok {
			return generation.Response{}, err
		}
		payloadResponse = recovered
	}

	return payloadResponse.toGenerationResponse(request.Model, payload.OutputFormat), nil
}

// recoverImagesResult polls the aggregation platform's buffered-result
// endpoint after a transport failure (client timeout, dropped connection).
// The generation usually keeps running — and stays billed — upstream, so a
// short polling window can still deliver the paid-for image instead of
// failing the task.
func (provider *Provider) recoverImagesResult(ctx context.Context, key string, cause error) (imagesResponse, bool) {
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
				return imagesResponse{}, false // 200 with an undecodable body
			}
			continue // transient poll failure — keep trying inside the window
		}
		switch status {
		case http.StatusOK:
			return recovered, true
		case http.StatusAccepted:
			// Still generating upstream — keep waiting.
		default:
			// 404 = unknown/expired key (or the endpoint is not deployed);
			// nothing recoverable behind any other status either.
			return imagesResponse{}, false
		}
	}
	return imagesResponse{}, false
}

// isTransportError reports whether err came from the transport layer (client
// timeout, dropped connection) rather than an HTTP-level error response. Only
// transport failures leave a completed result stranded on the server.
func isTransportError(err error) bool {
	var urlErr *url.Error
	return errors.As(err, &urlErr) || errors.Is(err, context.DeadlineExceeded)
}

func newImageRecoveryKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "imgreq_" + hex.EncodeToString(buf), nil
}

type chatCompletionRequest struct {
	Model         string         `json:"model"`
	Messages      []chatMessage  `json:"messages"`
	Modalities    []string       `json:"modalities,omitempty"`
	Stream        bool           `json:"stream"`
	StreamOptions map[string]any `json:"stream_options,omitempty"`
	Temperature   *float64       `json:"temperature,omitempty"`
	MaxTokens     *int           `json:"max_tokens,omitempty"`
	ImageConfig   map[string]any `json:"image_config,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatCompletionResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content any `json:"content"`
			Images  []struct {
				Type     string `json:"type"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
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
	Provider          map[string]any   `json:"provider,omitempty"`
}

type imagesResponse struct {
	ID      string `json:"id"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Data    []struct {
		URL           string `json:"url"`
		B64JSON       string `json:"b64_json"`
		MediaType     string `json:"media_type"`
		RevisedPrompt string `json:"revised_prompt"`
	} `json:"data"`
	Usage struct {
		PromptTokens     int     `json:"prompt_tokens"`
		CompletionTokens int     `json:"completion_tokens"`
		TotalTokens      int     `json:"total_tokens"`
		Cost             float64 `json:"cost"`
	} `json:"usage"`
}

func (response chatCompletionResponse) toGenerationResponse(model string) generation.Response {
	assets := []generation.Asset{}
	for _, choice := range response.Choices {
		for _, image := range choice.Message.Images {
			if image.ImageURL.URL == "" {
				continue
			}
			assets = append(assets, generation.Asset{
				Kind: generation.KindImage,
				URL:  image.ImageURL.URL,
			})
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
			mimeType := firstNonEmpty(item.MediaType, imageMIMEType(outputFormat))
			asset := generation.Asset{
				Kind:     generation.KindImage,
				Base64:   item.B64JSON,
				MIMEType: mimeType,
			}
			if item.RevisedPrompt != "" {
				asset.Metadata = map[string]any{"revised_prompt": item.RevisedPrompt}
			}
			assets = append(assets, asset)
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
		Metadata: map[string]any{
			"created": response.Created,
			"cost":    response.Usage.Cost,
		},
	}
}

func openAIProviderOptions(params map[string]any) map[string]any {
	moderation := paramString(params, "moderation")
	if moderation == "" {
		return nil
	}

	return map[string]any{
		"options": map[string]any{
			"openai": map[string]any{
				"moderation": moderation,
			},
		},
	}
}

func (provider *Provider) imageProviderOptions(params map[string]any) map[string]any {
	if mediago.SuppressOpenAIProviderOptions(provider.providerName) {
		return nil
	}
	return openAIProviderOptions(params)
}

func (provider *Provider) omitChatImageSize(request generation.Request) bool {
	return mediago.OmitChatImageSize(provider.providerName, request.Model)
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
