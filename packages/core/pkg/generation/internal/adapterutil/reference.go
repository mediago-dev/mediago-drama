package adapterutil

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

var ReferenceImageByteLimit int64 = 50 << 20

func ReadImageReference(
	ctx context.Context,
	client *http.Client,
	reference string,
	readHTTPError func(*http.Response) error,
) (string, []byte, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", nil, fmt.Errorf("reference image is empty")
	}
	if strings.HasPrefix(strings.ToLower(reference), "data:") {
		return DecodeImageDataURI(reference)
	}
	if !strings.HasPrefix(strings.ToLower(reference), "http://") &&
		!strings.HasPrefix(strings.ToLower(reference), "https://") {
		return "", nil, fmt.Errorf("reference image must be a data URI or HTTP URL")
	}
	if client == nil {
		client = http.DefaultClient
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, reference, nil)
	if err != nil {
		return "", nil, err
	}
	response, err := client.Do(httpRequest)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if readHTTPError != nil {
			return "", nil, readHTTPError(response)
		}
		return "", nil, fmt.Errorf("reference image request failed with status %d", response.StatusCode)
	}

	mimeType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if mimeType == "" {
		mimeType = "image/png"
	}
	if err := ValidateImageMIMEType(mimeType); err != nil {
		return "", nil, err
	}
	data, err := ReadImageReferenceBody(response.Body)
	if err != nil {
		return "", nil, err
	}

	return mimeType, data, nil
}

func DecodeImageDataURI(value string) (string, []byte, error) {
	payload := strings.TrimSpace(value)
	if len(payload) >= len("data:") && strings.EqualFold(payload[:len("data:")], "data:") {
		payload = payload[len("data:"):]
	}
	metadata, encoded, ok := strings.Cut(payload, ",")
	if !ok {
		return "", nil, fmt.Errorf("invalid data URI")
	}
	metadataParts := strings.Split(metadata, ";")
	mimeType := strings.TrimSpace(metadataParts[0])
	if mimeType == "" {
		mimeType = "image/png"
	}
	if err := ValidateImageMIMEType(mimeType); err != nil {
		return "", nil, err
	}

	isBase64 := false
	for _, part := range metadataParts[1:] {
		if strings.EqualFold(strings.TrimSpace(part), "base64") {
			isBase64 = true
			break
		}
	}
	if isBase64 {
		data, err := ReadImageReferenceBody(base64.NewDecoder(base64.StdEncoding, strings.NewReader(encoded)))
		if err != nil {
			return "", nil, err
		}
		return mimeType, data, nil
	}

	decoded, err := url.PathUnescape(encoded)
	if err != nil {
		return "", nil, err
	}
	data := []byte(decoded)
	if err := ValidateImageReferenceData(data); err != nil {
		return "", nil, err
	}
	return mimeType, data, nil
}

func ReadImageReferenceBody(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, ReferenceImageByteLimit+1))
	if err != nil {
		return nil, err
	}
	if err := ValidateImageReferenceData(data); err != nil {
		return nil, err
	}

	return data, nil
}

func ValidateImageMIMEType(mimeType string) error {
	mimeType = strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	if !strings.HasPrefix(mimeType, "image/") {
		return fmt.Errorf("reference image content type %q is not an image", mimeType)
	}

	return nil
}

func ValidateImageReferenceData(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("reference image is empty")
	}
	if int64(len(data)) > ReferenceImageByteLimit {
		return fmt.Errorf("reference image exceeds %d bytes", ReferenceImageByteLimit)
	}

	return nil
}

func ImageExtension(mimeType string) string {
	extensions, err := mime.ExtensionsByType(mimeType)
	if err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}
