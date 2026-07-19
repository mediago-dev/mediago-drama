package official

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const aliyunWanGenerationPath = "/api/v1/services/aigc/multimodal-generation/generation"

type aliyunWanRequest struct {
	Model      string              `json:"model"`
	Input      aliyunWanInput      `json:"input"`
	Parameters aliyunWanParameters `json:"parameters"`
}

type aliyunWanInput struct {
	Messages []aliyunWanMessage `json:"messages"`
}

type aliyunWanMessage struct {
	Role    string             `json:"role"`
	Content []aliyunWanContent `json:"content"`
}

type aliyunWanContent struct {
	Image string `json:"image,omitempty"`
	Text  string `json:"text,omitempty"`
}

type aliyunWanParameters struct {
	Size             string `json:"size"`
	N                int    `json:"n"`
	Watermark        bool   `json:"watermark"`
	EnableSequential bool   `json:"enable_sequential"`
	ThinkingMode     *bool  `json:"thinking_mode,omitempty"`
	Seed             *int   `json:"seed,omitempty"`
}

type aliyunWanResponse struct {
	StatusCode int    `json:"status_code"`
	RequestID  string `json:"request_id"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	Output     struct {
		Finished bool `json:"finished"`
		Choices  []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Role    string `json:"role"`
				Content []struct {
					Type  string `json:"type"`
					Image string `json:"image"`
					Text  string `json:"text"`
				} `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	} `json:"output"`
	Usage struct {
		InputTokens  int    `json:"input_tokens"`
		OutputTokens int    `json:"output_tokens"`
		TotalTokens  int    `json:"total_tokens"`
		ImageCount   int    `json:"image_count"`
		Size         string `json:"size"`
	} `json:"usage"`
}

func (provider *Provider) generateAliyunWanImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	if err := validateAliyunWanRequest(request); err != nil {
		return generation.Response{}, err
	}

	payload := aliyunWanPayload(request)
	result := aliyunWanResponse{}
	if err := provider.postJSON(
		ctx,
		provider.aliyunBaseURL+aliyunWanGenerationPath,
		provider.bearerAuthorization(),
		payload,
		&result,
	); err != nil {
		return generation.Response{}, err
	}
	if result.StatusCode != 0 && result.StatusCode != 200 {
		return generation.Response{}, aliyunWanResponseError(result)
	}
	if strings.TrimSpace(result.Code) != "" {
		return generation.Response{}, aliyunWanResponseError(result)
	}

	assets := make([]generation.Asset, 0, result.Usage.ImageCount)
	for _, choice := range result.Output.Choices {
		for _, content := range choice.Message.Content {
			if strings.TrimSpace(content.Image) == "" {
				continue
			}
			assets = append(assets, generation.Asset{
				Kind:     generation.KindImage,
				URL:      content.Image,
				MIMEType: "image/png",
			})
		}
	}
	if len(assets) == 0 {
		return generation.Response{}, fmt.Errorf("aliyun wan image generation returned no images")
	}

	return generation.Response{
		ID:     firstNonEmpty(result.RequestID, request.RouteID),
		Status: "completed",
		Model:  request.Model,
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens,
			TotalTokens:  result.Usage.TotalTokens,
		},
		Metadata: map[string]any{
			"request_id":  result.RequestID,
			"image_count": result.Usage.ImageCount,
			"size":        result.Usage.Size,
		},
	}, nil
}

func aliyunWanPayload(request generation.Request) aliyunWanRequest {
	content := make([]aliyunWanContent, 0, len(request.ReferenceURLs)+1)
	for _, referenceURL := range compactStrings(request.ReferenceURLs) {
		content = append(content, aliyunWanContent{Image: referenceURL})
	}
	content = append(content, aliyunWanContent{Text: request.Prompt})

	parameters := aliyunWanParameters{
		Size:             firstNonEmpty(paramString(request.Params, "size"), "2048*2048"),
		N:                paramInt(request.Params, "n", 1),
		Watermark:        boolParamValue(request.Params, "watermark", request.Watermark, false),
		EnableSequential: false,
		Seed:             paramIntPointer(request.Params, "seed"),
	}
	if len(compactStrings(request.ReferenceURLs)) == 0 {
		thinkingMode := paramBool(request.Params, "thinking_mode", true)
		parameters.ThinkingMode = &thinkingMode
	}

	return aliyunWanRequest{
		Model: request.Model,
		Input: aliyunWanInput{Messages: []aliyunWanMessage{
			{Role: "user", Content: content},
		}},
		Parameters: parameters,
	}
}

func validateAliyunWanRequest(request generation.Request) error {
	if request.Model != generation.ModelWan27ImagePro && request.Model != generation.ModelWan27Image {
		return fmt.Errorf("unsupported aliyun wan image model %q", request.Model)
	}
	if utf8.RuneCountInString(request.Prompt) > 5000 {
		return fmt.Errorf("aliyun wan prompt must contain at most 5000 characters")
	}
	if len(compactStrings(request.ReferenceURLs)) > 9 {
		return fmt.Errorf("aliyun wan image generation supports at most 9 reference images")
	}
	if paramBool(request.Params, "enable_sequential", false) {
		return fmt.Errorf("aliyun wan sequential image generation is not enabled for this route")
	}

	n := paramInt(request.Params, "n", 1)
	if n < 1 || n > 4 {
		return fmt.Errorf("aliyun wan image count n must be between 1 and 4 in non-sequential mode")
	}

	size := firstNonEmpty(paramString(request.Params, "size"), "2048*2048")
	if isAliyunWan4KSize(size) {
		if request.Model != generation.ModelWan27ImagePro {
			return fmt.Errorf("aliyun wan model %q does not support 4K output", request.Model)
		}
		if len(compactStrings(request.ReferenceURLs)) > 0 {
			return fmt.Errorf("aliyun wan 4K output requires no reference images")
		}
	}

	return nil
}

func isAliyunWan4KSize(size string) bool {
	size = strings.TrimSpace(size)
	if strings.EqualFold(size, "4K") {
		return true
	}
	parts := strings.FieldsFunc(size, func(value rune) bool {
		return value == '*' || value == 'x' || value == 'X'
	})
	if len(parts) != 2 {
		return false
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil {
		return false
	}
	return int64(width)*int64(height) > int64(2048*2048)
}

func aliyunWanResponseError(response aliyunWanResponse) error {
	message := strings.TrimSpace(response.Message)
	if message == "" {
		message = "provider returned a non-success status"
	}
	if code := strings.TrimSpace(response.Code); code != "" {
		return fmt.Errorf("aliyun wan image generation failed (%s): %s", code, message)
	}
	return fmt.Errorf("aliyun wan image generation failed: %s", message)
}
