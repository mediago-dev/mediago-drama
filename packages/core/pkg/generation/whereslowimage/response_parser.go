package whereslowimage

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func parseGeminiResponse(raw json.RawMessage, model string) (generation.Response, error) {
	var response geminiResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return generation.Response{}, fmt.Errorf("decoding whereslow Gemini response: %w", err)
	}

	assets := make([]generation.Asset, 0)
	texts := make([]string, 0)
	finishReasons := make([]string, 0)
	for _, candidate := range response.Candidates {
		if reason := strings.TrimSpace(candidate.FinishReason); reason != "" {
			finishReasons = append(finishReasons, reason)
		}
		for _, part := range candidate.Content.Parts {
			if text := strings.TrimSpace(part.Text); text != "" {
				texts = append(texts, text)
				for _, embedded := range extractEmbeddedDataImages(text) {
					asset, err := base64ImageAsset(embedded.Data, embedded.MIMEType)
					if err == nil {
						assets = append(assets, asset)
					}
				}
			}
			inline := part.InlineData
			if inline == nil {
				inline = part.InlineDataSnake
			}
			if inline != nil && strings.TrimSpace(inline.Data) != "" {
				mimeType := firstNonEmpty(inline.MIMEType, inline.MIMETypeSnake, "image/png")
				asset, err := base64ImageAsset(inline.Data, mimeType)
				if err != nil {
					return generation.Response{}, err
				}
				assets = append(assets, asset)
			}
			fileData := part.FileData
			if fileData == nil {
				fileData = part.FileDataSnake
			}
			if fileData != nil {
				if fileURI := firstNonEmpty(fileData.FileURI, fileData.FileURISnake); fileURI != "" {
					assets = append(assets, generation.Asset{Kind: generation.KindImage, URL: fileURI, MIMEType: firstNonEmpty(fileData.MIMEType, fileData.MIMETypeSnake)})
				}
			}
			if part.ImageURL != nil && strings.TrimSpace(part.ImageURL.URL) != "" {
				assets = append(assets, generation.Asset{Kind: generation.KindImage, URL: strings.TrimSpace(part.ImageURL.URL)})
			}
		}
	}
	for _, choice := range response.Choices {
		for _, image := range choice.Message.Images {
			if imageURL := strings.TrimSpace(image.ImageURL.URL); imageURL != "" {
				assets = append(assets, generation.Asset{Kind: generation.KindImage, URL: imageURL})
			}
		}
	}
	for _, image := range response.Data {
		var err error
		assets, err = appendCompatImage(assets, image)
		if err != nil {
			return generation.Response{}, err
		}
	}
	for _, image := range response.Images {
		var err error
		assets, err = appendCompatImage(assets, image)
		if err != nil {
			return generation.Response{}, err
		}
	}
	if response.Image != nil {
		var err error
		assets, err = appendCompatImage(assets, *response.Image)
		if err != nil {
			return generation.Response{}, err
		}
	}

	if len(assets) == 0 {
		summary := summarizeGeminiResponse(raw)
		slog.Warn("[ImageGenerationResponse] Gemini returned no image",
			"top_level_keys", summary.TopLevelKeys,
			"candidates", summary.CandidateCount,
			"parts", summary.PartCount,
			"part_fields", summary.PartFields,
			"mime_types", summary.MIMETypes,
			"data_lengths", summary.DataLengths,
			"finish_reasons", finishReasons,
			"has_prompt_feedback", response.PromptFeedback != nil,
			"has_error", response.Error != nil,
			"has_message", response.Message != nil,
		)
		detail := "WhereSlow response contained no extractable image."
		if len(finishReasons) > 0 {
			detail += " finishReason=" + strings.Join(finishReasons, ",")
		}
		if len(texts) > 0 {
			excerpt := strings.TrimSpace(strings.Join(texts, " | "))
			if len(excerpt) > 300 {
				excerpt = excerpt[:300] + "..."
			}
			detail += " text=" + excerpt
		}
		if len(summary.TopLevelKeys) > 0 {
			detail += " topLevelKeys=" + strings.Join(summary.TopLevelKeys, ",")
		}
		if len(summary.PartFields) > 0 {
			detail += " partFields=" + strings.Join(summary.PartFields, ",")
		}
		return generation.Response{}, fmt.Errorf("%s", detail)
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
		Metadata: map[string]any{"text": texts},
	}, nil
}

func appendCompatImage(assets []generation.Asset, image compatImage) ([]generation.Asset, error) {
	if imageURL := strings.TrimSpace(image.URL); imageURL != "" {
		return append(assets, generation.Asset{Kind: generation.KindImage, URL: imageURL}), nil
	}
	data := firstNonEmpty(image.B64JSON, image.Data)
	if data == "" {
		return assets, nil
	}
	asset, err := base64ImageAsset(data, firstNonEmpty(image.MIMEType, image.MIMESnake, "image/png"))
	if err != nil {
		return nil, err
	}
	return append(assets, asset), nil
}

func base64ImageAsset(data string, mimeType string) (generation.Asset, error) {
	data = strings.TrimSpace(data)
	if comma := strings.Index(data, ","); strings.HasPrefix(data, "data:") && comma >= 0 {
		if header := data[5:comma]; strings.Contains(header, ";base64") {
			if mediaType := strings.TrimSpace(strings.SplitN(header, ";", 2)[0]); mediaType != "" {
				mimeType = mediaType
			}
			data = data[comma+1:]
		}
	}
	mimeType = strings.TrimSpace(mimeType)
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return generation.Asset{}, fmt.Errorf("Gemini returned inline data with non-image MIME type %q", mimeType)
	}
	if _, err := base64.StdEncoding.DecodeString(data); err != nil {
		if _, rawErr := base64.RawStdEncoding.DecodeString(data); rawErr != nil {
			return generation.Asset{}, fmt.Errorf("Gemini returned invalid base64 image data: %w", err)
		}
	}
	return generation.Asset{Kind: generation.KindImage, Base64: data, MIMEType: mimeType}, nil
}

type embeddedDataImage struct {
	MIMEType string
	Data     string
}

func extractEmbeddedDataImages(text string) []embeddedDataImage {
	const marker = "data:image/"
	lower := strings.ToLower(text)
	results := make([]embeddedDataImage, 0)

	for searchFrom := 0; searchFrom < len(text); {
		rel := strings.Index(lower[searchFrom:], marker)
		if rel < 0 {
			break
		}
		start := searchFrom + rel

		commaRel := strings.Index(text[start:], ",")
		if commaRel < 0 {
			break
		}
		comma := start + commaRel
		header := strings.TrimSpace(text[start+len("data:") : comma])
		lowerHeader := strings.ToLower(header)
		if !strings.HasPrefix(lowerHeader, "image/") || !strings.Contains(lowerHeader, ";base64") {
			searchFrom = comma + 1
			continue
		}

		mimeType := strings.TrimSpace(strings.SplitN(header, ";", 2)[0])
		var b64 strings.Builder

		for i := comma + 1; i < len(text); i++ {
			ch := text[i]

			switch {
			case ch >= 'A' && ch <= 'Z':
				b64.WriteByte(ch)
			case ch >= 'a' && ch <= 'z':
				b64.WriteByte(ch)
			case ch >= '0' && ch <= '9':
				b64.WriteByte(ch)
			case ch == '+' || ch == '/' || ch == '=':
				b64.WriteByte(ch)
			case ch == '\r' || ch == '\n' || ch == '\t' || ch == ' ':
				// Some relays wrap a long data URI across lines. Ignore whitespace.
				continue
			default:
				// Markdown usually terminates the URI with ')'. Any other
				// non-base64 character also ends the payload safely.
				i = len(text)
			}
		}

		data := b64.String()
		if data != "" {
			if _, err := base64.StdEncoding.DecodeString(data); err == nil {
				results = append(results, embeddedDataImage{
					MIMEType: firstNonEmpty(mimeType, "image/png"),
					Data:     data,
				})
			} else if _, err := base64.RawStdEncoding.DecodeString(data); err == nil {
				results = append(results, embeddedDataImage{
					MIMEType: firstNonEmpty(mimeType, "image/png"),
					Data:     data,
				})
			}
		}

		searchFrom = comma + 1
	}

	return results
}

type responseStructureSummary struct {
	TopLevelKeys   []string
	CandidateCount int
	PartCount      int
	PartFields     []string
	MIMETypes      []string
	DataLengths    []int
}

func summarizeGeminiResponse(raw json.RawMessage) responseStructureSummary {
	var root map[string]any
	if json.Unmarshal(raw, &root) != nil {
		return responseStructureSummary{}
	}
	summary := responseStructureSummary{TopLevelKeys: sortedKeys(root)}
	candidates, _ := root["candidates"].([]any)
	summary.CandidateCount = len(candidates)
	fieldSet := map[string]struct{}{}
	mimeSet := map[string]struct{}{}
	for _, candidateValue := range candidates {
		candidate, _ := candidateValue.(map[string]any)
		content, _ := candidate["content"].(map[string]any)
		parts, _ := content["parts"].([]any)
		summary.PartCount += len(parts)
		for _, partValue := range parts {
			part, _ := partValue.(map[string]any)
			for _, field := range sortedKeys(part) {
				fieldSet[field] = struct{}{}
			}
			for _, field := range []string{"inlineData", "inline_data"} {
				inline, _ := part[field].(map[string]any)
				if inline == nil {
					continue
				}
				for _, mimeField := range []string{"mimeType", "mime_type"} {
					if mime, ok := inline[mimeField].(string); ok && mime != "" {
						mimeSet[mime] = struct{}{}
					}
				}
				if data, ok := inline["data"].(string); ok {
					summary.DataLengths = append(summary.DataLengths, len(data))
				}
			}
		}
	}
	for field := range fieldSet {
		summary.PartFields = append(summary.PartFields, field)
	}
	for mime := range mimeSet {
		summary.MIMETypes = append(summary.MIMETypes, mime)
	}
	sort.Strings(summary.PartFields)
	sort.Strings(summary.MIMETypes)
	return summary
}

func sortedKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
