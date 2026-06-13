package generation

import (
	"context"
	"log/slog"
	"strings"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

type generationProviderLogContext struct {
	Action string
	TaskID string
}

func (workflow *GenerationService) generateWithProvider(
	ctx context.Context,
	provider coregeneration.Provider,
	request coregeneration.Request,
	logContext generationProviderLogContext,
) (coregeneration.Response, error) {
	startedAt := time.Now()
	logArgs := generationProviderLogArgs(provider, request, logContext)

	slog.Info(
		"generation provider request started",
		append(logArgs, "request", sanitizedGenerationRequest(request))...,
	)
	response, err := provider.Generate(ctx, request)
	duration := time.Since(startedAt)
	if err != nil {
		slog.Warn(
			"generation provider request failed",
			append(logArgs, "duration_ms", duration.Milliseconds(), "error", err)...,
		)
		return response, err
	}

	slog.Info(
		"generation provider request completed",
		append(
			logArgs,
			"duration_ms",
			duration.Milliseconds(),
			"response",
			sanitizedGenerationResponse(response),
		)...,
	)
	return response, nil
}

func generationProviderLogArgs(
	provider coregeneration.Provider,
	request coregeneration.Request,
	logContext generationProviderLogContext,
) []any {
	return []any{
		"provider", provider.Name(),
		"action", logContext.Action,
		"task_id", logContext.TaskID,
		"kind", request.Kind,
		"route_id", request.RouteID,
		"family_id", request.FamilyID,
		"version_id", request.VersionID,
		"provider", request.Provider,
		"model", request.Model,
	}
}

func sanitizedGenerationRequest(request coregeneration.Request) map[string]any {
	return map[string]any{
		"kind":            request.Kind,
		"route_id":        request.RouteID,
		"family_id":       request.FamilyID,
		"version_id":      request.VersionID,
		"provider":        request.Provider,
		"model_id":        request.ModelID,
		"model":           request.Model,
		"prompt":          request.Prompt,
		"prompt_bytes":    len(request.Prompt),
		"reference_count": len(request.ReferenceURLs),
		"reference_urls":  sanitizedReferenceURLs(request.ReferenceURLs),
		"output_format":   request.OutputFormat,
		"response_format": request.ResponseFormat,
		"watermark":       request.Watermark,
		"params":          sanitizedLogValue(request.Params),
		"options":         sanitizedLogValue(request.Options),
	}
}

func sanitizedGenerationResponse(response coregeneration.Response) map[string]any {
	return map[string]any{
		"id":          response.ID,
		"status":      response.Status,
		"model":       response.Model,
		"text_bytes":  len(response.Text),
		"asset_count": len(response.Assets),
		"assets":      sanitizedGenerationAssets(response.Assets),
		"usage":       response.Usage,
		"metadata":    sanitizedLogValue(response.Metadata),
	}
}

func sanitizedGenerationAssets(assets []coregeneration.Asset) []map[string]any {
	values := make([]map[string]any, 0, len(assets))
	for index, asset := range assets {
		value := map[string]any{
			"index":     index,
			"kind":      asset.Kind,
			"url":       sanitizedLogString(asset.URL),
			"mime_type": asset.MIMEType,
			"metadata":  sanitizedLogValue(asset.Metadata),
		}
		if asset.Base64 != "" {
			value["base64"] = base64OmittedSummary(asset.MIMEType, asset.Base64)
		}
		values = append(values, value)
	}

	return values
}

func sanitizedReferenceURLs(values []string) []map[string]any {
	references := make([]map[string]any, 0, len(values))
	for index, value := range values {
		references = append(references, sanitizedReferenceURL(index, value))
	}

	return references
}

func sanitizedReferenceURL(index int, value string) map[string]any {
	reference := map[string]any{
		"index": index,
		"bytes": len(value),
	}
	trimmed := strings.TrimSpace(value)
	metadata, encoded, ok := strings.Cut(trimmed, ",")
	if ok && strings.HasPrefix(strings.ToLower(metadata), "data:") {
		mimeType := strings.TrimPrefix(metadata, "data:")
		mimeType = strings.TrimSuffix(mimeType, ";base64")
		reference["type"] = "data_uri"
		reference["mime_type"] = mimeType
		reference["value"] = "data:" + mimeType + ";base64,<omitted>"
		reference["base64_chars"] = len(encoded)
		reference["estimated_data_bytes"] = estimatedBase64DecodedBytes(encoded)
		return reference
	}

	reference["type"] = "url"
	reference["value"] = sanitizedLogString(trimmed)
	return reference
}

func sanitizedLogValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return sanitizedLogString(typed)
	case []string:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			values = append(values, sanitizedLogString(item))
		}
		return values
	case []any:
		values := make([]any, 0, len(typed))
		for _, item := range typed {
			values = append(values, sanitizedLogValue(item))
		}
		return values
	case map[string]any:
		values := make(map[string]any, len(typed))
		for key, item := range typed {
			values[key] = sanitizedLogValue(item)
		}
		return values
	case map[string]string:
		values := make(map[string]string, len(typed))
		for key, item := range typed {
			values[key] = sanitizedLogString(item)
		}
		return values
	default:
		return value
	}
}

func sanitizedLogString(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return value
	}
	metadata, encoded, ok := strings.Cut(trimmed, ",")
	if ok && strings.HasPrefix(strings.ToLower(metadata), "data:") {
		mimeType := strings.TrimPrefix(metadata, "data:")
		mimeType = strings.TrimSuffix(mimeType, ";base64")
		return "data:" + mimeType + ";base64,<omitted:" + decimalString(len(encoded)) + " chars>"
	}

	return value
}

func base64OmittedSummary(mimeType string, encoded string) string {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		mimeType = "unknown"
	}

	return mimeType + ";base64,<omitted:" + decimalString(len(encoded)) + " chars>"
}

func estimatedBase64DecodedBytes(encoded string) int {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return 0
	}

	padding := 0
	if strings.HasSuffix(encoded, "==") {
		padding = 2
	} else if strings.HasSuffix(encoded, "=") {
		padding = 1
	}
	estimated := len(encoded)*3/4 - padding
	if estimated < 0 {
		return 0
	}

	return estimated
}

func decimalString(value int) string {
	if value == 0 {
		return "0"
	}

	const digits = "0123456789"
	buffer := [20]byte{}
	index := len(buffer)
	for value > 0 {
		index--
		buffer[index] = digits[value%10]
		value /= 10
	}

	return string(buffer[index:])
}
