package dmx

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

type imagesGenerationsRequest struct {
	Model             string `json:"model"`
	Prompt            string `json:"prompt"`
	N                 int    `json:"n,omitempty"`
	Size              string `json:"size,omitempty"`
	OutputFormat      string `json:"output_format,omitempty"`
	OutputCompression *int   `json:"output_compression,omitempty"`
	Quality           string `json:"quality,omitempty"`
	Moderation        string `json:"moderation,omitempty"`
}

type imagesGenerationsResponse struct {
	Created int64                       `json:"created"`
	Data    []imagesGenerationsDataItem `json:"data"`
	Usage   imageResponseUsage          `json:"usage"`
}

type imagesGenerationsDataItem struct {
	URL           string `json:"url"`
	B64JSON       string `json:"b64_json"`
	RevisedPrompt string `json:"revised_prompt"`
}

func (provider *Provider) generateImages(ctx context.Context, request generation.Request) (generation.Response, error) {
	if len(compactStrings(request.ReferenceURLs)) > 0 {
		return provider.editImages(ctx, request)
	}

	payload := imagesGenerationsRequest{
		Model:             request.Model,
		Prompt:            request.Prompt,
		N:                 paramInt(request.Params, "n", 1),
		Size:              firstNonEmpty(paramString(request.Params, "size"), request.Size, "1024x1024"),
		OutputFormat:      firstNonEmpty(paramString(request.Params, "outputFormat"), request.OutputFormat, "png"),
		OutputCompression: paramIntPointer(request.Params, "outputCompression"),
		Quality:           paramString(request.Params, "quality"),
		Moderation:        paramString(request.Params, "moderation"),
	}

	var payloadResponse imagesGenerationsResponse
	if err := provider.postJSON(ctx, "/v1/images/generations", payload, provider.videoAuthorization(), &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func (provider *Provider) editImages(ctx context.Context, request generation.Request) (generation.Response, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writeMultipartFields(writer, imagesGenerationsRequest{
		Model:             request.Model,
		Prompt:            request.Prompt,
		N:                 paramInt(request.Params, "n", 1),
		Size:              firstNonEmpty(paramString(request.Params, "size"), request.Size, "1024x1024"),
		OutputFormat:      firstNonEmpty(paramString(request.Params, "outputFormat"), request.OutputFormat, "png"),
		OutputCompression: paramIntPointer(request.Params, "outputCompression"),
		Quality:           paramString(request.Params, "quality"),
		Moderation:        paramString(request.Params, "moderation"),
	}); err != nil {
		return generation.Response{}, err
	}
	for index, reference := range compactStrings(request.ReferenceURLs) {
		if err := provider.writeImageReferencePart(ctx, writer, reference, index); err != nil {
			return generation.Response{}, err
		}
	}
	if err := writer.Close(); err != nil {
		return generation.Response{}, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+"/v1/images/edits", &body)
	if err != nil {
		return generation.Response{}, err
	}
	httpRequest.Header.Set("Content-Type", writer.FormDataContentType())
	httpRequest.Header.Set("Authorization", provider.videoAuthorization())

	var payloadResponse imagesGenerationsResponse
	if err := provider.doJSON(httpRequest, &payloadResponse); err != nil {
		return generation.Response{}, err
	}

	return payloadResponse.toGenerationResponse(request.Model), nil
}

func writeMultipartFields(writer *multipart.Writer, payload imagesGenerationsRequest) error {
	if err := writer.WriteField("model", payload.Model); err != nil {
		return err
	}
	if err := writer.WriteField("prompt", payload.Prompt); err != nil {
		return err
	}
	if payload.N > 0 {
		if err := writer.WriteField("n", fmt.Sprintf("%d", payload.N)); err != nil {
			return err
		}
	}
	if payload.Size != "" {
		if err := writer.WriteField("size", payload.Size); err != nil {
			return err
		}
	}
	if payload.OutputFormat != "" {
		if err := writer.WriteField("output_format", payload.OutputFormat); err != nil {
			return err
		}
	}
	if payload.OutputCompression != nil {
		if err := writer.WriteField("output_compression", fmt.Sprintf("%d", *payload.OutputCompression)); err != nil {
			return err
		}
	}
	if payload.Quality != "" {
		if err := writer.WriteField("quality", payload.Quality); err != nil {
			return err
		}
	}
	if payload.Moderation != "" {
		if err := writer.WriteField("moderation", payload.Moderation); err != nil {
			return err
		}
	}

	return nil
}

func (response imagesGenerationsResponse) toGenerationResponse(model string) generation.Response {
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
			assets = append(assets, generation.Asset{
				Kind:   generation.KindImage,
				Base64: item.B64JSON,
			})
		}
	}

	return generation.Response{
		Status: "completed",
		Model:  model,
		Assets: assets,
		Usage:  response.Usage.toGenerationUsage(),
		Metadata: map[string]any{
			"created": response.Created,
		},
	}
}
