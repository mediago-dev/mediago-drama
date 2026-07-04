package dmx

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateImage(t *testing.T) {
	var authHeader string
	var payload imageRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q, want /v1/responses", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{
			"id":"resp_1",
			"object":"response",
			"status":"completed",
			"model":"doubao-seedream-5.0-lite",
			"output":[{"type":"image_url","image_url":{"url":"https://example.test/image.png"}}],
			"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		Prompt:        "make an image",
		ReferenceURLs: []string{"https://example.test/ref.png"},
		Params: map[string]any{
			"size":      "2K",
			"watermark": true,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "sk-test" {
		t.Fatalf("Authorization = %q, want sk-test", authHeader)
	}
	if payload.Model != "doubao-seedream-5.0-lite" || payload.Input != "make an image" {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.SequentialImageGeneration != "auto" {
		t.Fatalf("sequential_image_generation = %q, want auto", payload.SequentialImageGeneration)
	}
	if payload.Watermark == nil || *payload.Watermark != true {
		t.Fatalf("watermark = %#v, want true", payload.Watermark)
	}
	if got := response.Assets[0].URL; got != "https://example.test/image.png" {
		t.Fatalf("asset url = %q, want image URL", got)
	}
	if response.Usage.TotalTokens != 3 {
		t.Fatalf("usage total = %d, want 3", response.Usage.TotalTokens)
	}
}

func TestNewProviderDefaultHTTPTimeoutMatchesSlowImageModels(t *testing.T) {
	provider, err := NewProvider(Config{APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}
	if provider.client.Timeout != 1000*time.Second {
		t.Fatalf("client timeout = %s, want 1000s", provider.client.Timeout)
	}
	transport, ok := provider.client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T, want *http.Transport", provider.client.Transport)
	}
	if transport.TLSHandshakeTimeout != 45*time.Second {
		t.Fatalf("tls handshake timeout = %s, want 45s", transport.TLSHandshakeTimeout)
	}
}

func TestGenerateTextStreamRetriesTLSHandshakeTimeout(t *testing.T) {
	attempts := 0
	provider, err := NewProvider(Config{
		BaseURL: "https://example.test",
		APIKey:  "sk-test",
		HTTPClient: &http.Client{
			Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
				attempts++
				if attempts == 1 {
					return nil, errors.New("net/http: TLS handshake timeout")
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body: io.NopCloser(strings.NewReader(
						"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n" +
							"data: [DONE]\n\n",
					)),
					Request: request,
				}, nil
			}),
		},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	stream, err := provider.GenerateTextStream(context.Background(), generation.Request{
		Kind:    generation.KindText,
		RouteID: generation.RouteDMXGPT41MiniText,
		Prompt:  "hello",
	})
	if err != nil {
		t.Fatalf("GenerateTextStream() error = %v", err)
	}
	defer stream.Close()
	event, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() error = %v", err)
	}
	if event.Delta != "ok" || attempts != 2 {
		t.Fatalf("event=%#v attempts=%d, want retried stream", event, attempts)
	}
}

func TestGenerateTextStream(t *testing.T) {
	var authHeader string
	var payload dmxChatTextRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q, want /v1/chat/completions", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	stream, err := provider.GenerateTextStream(context.Background(), generation.Request{
		Kind:    generation.KindText,
		RouteID: generation.RouteDMXGPT41MiniText,
		Prompt:  "写一段话",
	})
	if err != nil {
		t.Fatalf("GenerateTextStream() error = %v", err)
	}
	defer stream.Close()

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload.Model != "gpt-4.1-mini" || !payload.Stream || payload.Messages[0].Content != "写一段话" {
		t.Fatalf("payload = %#v", payload)
	}

	event, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() error = %v", err)
	}
	if event.Delta != "你好" {
		t.Fatalf("delta = %q, want 你好", event.Delta)
	}
	event, err = stream.Recv()
	if err != nil {
		t.Fatalf("Recv() usage error = %v", err)
	}
	if event.Usage == nil || event.Usage.TotalTokens != 3 {
		t.Fatalf("usage event = %#v", event)
	}
	if _, err = stream.Recv(); err != io.EOF {
		t.Fatalf("Recv() final = %v, want EOF", err)
	}
}

func TestGenerateImageHTTPErrorIsStructured(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusTooManyRequests)
		_, _ = writer.Write([]byte("rate limited"))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindImage,
		Prompt: "make an image",
	})
	var httpErr *generation.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Generate() error = %T %v, want *generation.HTTPError", err, err)
	}
	if httpErr.Provider != generation.ProviderDMX ||
		httpErr.StatusCode != http.StatusTooManyRequests ||
		httpErr.Body != "rate limited" {
		t.Fatalf("HTTPError = %#v", httpErr)
	}
}

func TestReadHTTPErrorNormalizesPolicyViolation(t *testing.T) {
	body := `{"error":{"message":"task status failed: {\"code\":\"***.PolicyViolation\",\"message\":\"The request failed because the output video may be related to copyright restrictions.\"}","type":"rix_api_error","code":"dmxapi_service_error"}}`
	err := readHTTPError(&http.Response{
		StatusCode: http.StatusBadRequest,
		Body:       io.NopCloser(strings.NewReader(body)),
	})

	var httpErr *generation.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("readHTTPError() error = %T, want *generation.HTTPError", err)
	}
	if httpErr.Code != "policy_violation" ||
		httpErr.Reason != generation.FailurePolicyViolation ||
		httpErr.Retryable {
		t.Fatalf("HTTPError = %#v", httpErr)
	}

	failure, ok := generation.FailureFromError(err)
	if !ok {
		t.Fatal("FailureFromError() did not extract failure details")
	}
	if failure.Code != "policy_violation" ||
		failure.Reason != generation.FailurePolicyViolation ||
		failure.Message != "Provider policy rejected the generation request or result." ||
		failure.Retryable {
		t.Fatalf("FailureFromError() = %#v", failure)
	}
}

func TestReadHTTPErrorNormalizesInvalidParameter(t *testing.T) {
	body := `{"error":{"message":"API returned error: {\"error\":{\"code\":\"InvalidParameter\",\"message\":\"the parameter duration specified in the request is not valid for model doubao-seedance-2-0-fast in t2v\",\"type\":\"BadRequest\"}}","type":"rix_api_error","code":"dmxapi_http_400"}}`
	err := readHTTPError(&http.Response{
		StatusCode: http.StatusBadRequest,
		Body:       io.NopCloser(strings.NewReader(body)),
	})

	var httpErr *generation.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("readHTTPError() error = %T, want *generation.HTTPError", err)
	}
	if httpErr.Code != "invalid_parameter" ||
		httpErr.Reason != generation.FailureInvalidParameter ||
		httpErr.Message != "the parameter duration specified in the request is not valid for model doubao-seedance-2-0-fast in t2v" ||
		httpErr.Retryable {
		t.Fatalf("HTTPError = %#v", httpErr)
	}
}

func TestGenerateImageBase64Outputs(t *testing.T) {
	var payload imageRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{
			"id":"resp_1",
			"object":"response",
			"status":"completed",
			"model":"doubao-seedream-5.0-lite",
			"output":[
				{"type":"image","b64_json":"base64-one"},
				{"type":"image","image_base64":"base64-two"}
			]
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:           generation.KindImage,
		Prompt:         "make an image",
		ResponseFormat: "b64_json",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload.ResponseFormat != "b64_json" {
		t.Fatalf("response_format = %q, want b64_json", payload.ResponseFormat)
	}
	if len(response.Assets) != 2 {
		t.Fatalf("asset count = %d, want 2", len(response.Assets))
	}
	if response.Assets[0].Base64 != "base64-one" || response.Assets[1].Base64 != "base64-two" {
		t.Fatalf("assets = %#v, want base64 outputs", response.Assets)
	}
}

func TestGenerateImageMarkdownOutputs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{
			"id":"resp_1",
			"object":"response",
			"status":"completed",
			"model":"doubao-seedream-5.0-lite",
			"output":[
				{
					"type":"message",
					"status":"completed",
					"content":[
						{
							"type":"output_text",
							"text":"![Image 1](https://example.test/image-1.png)\n![Image 2](https://example.test/image-2.png)"
						}
					]
				}
			]
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindImage,
		Prompt: "make an image",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if len(response.Assets) != 2 {
		t.Fatalf("asset count = %d, want 2", len(response.Assets))
	}
	if response.Assets[0].URL != "https://example.test/image-1.png" ||
		response.Assets[1].URL != "https://example.test/image-2.png" {
		t.Fatalf("assets = %#v, want markdown image URLs", response.Assets)
	}
}

func TestGenerateImageDataOutputs(t *testing.T) {
	var payload imageRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{
			"object":"list",
			"created": 1234567890,
			"data":[
				{"b64_json":"base64-one"},
				{"url":"https://example.test/generated.png","revised_prompt":"expanded"}
			]
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:           generation.KindImage,
		Prompt:         "make an image",
		ResponseFormat: "b64_json",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload.ResponseFormat != "b64_json" {
		t.Fatalf("response_format = %q, want b64_json", payload.ResponseFormat)
	}
	if response.Status != "completed" {
		t.Fatalf("status = %q, want completed", response.Status)
	}
	if len(response.Assets) != 2 {
		t.Fatalf("asset count = %d, want 2", len(response.Assets))
	}
	if response.Assets[0].Base64 != "base64-one" || response.Assets[1].URL != "https://example.test/generated.png" {
		t.Fatalf("assets = %#v, want data outputs", response.Assets)
	}
}

func TestGenerateImagesGenerations(t *testing.T) {
	var authHeader string
	var payload imagesGenerationsRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/images/generations" {
			t.Fatalf("path = %q, want /v1/images/generations", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"created": 1,
			"data": [{"url":"https://example.test/gpt.png","revised_prompt":"expanded"}],
			"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		ModelID: generation.ModelGPTImage2,
		Prompt:  "make an image",
		Params: map[string]any{
			"size":              "1536x1024",
			"quality":           "high",
			"outputCompression": float64(75),
			"n":                 float64(2),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload.Model != "gpt-image-2-ssvip" || payload.Size != "1536x1024" || payload.N != 2 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.OutputCompression == nil || *payload.OutputCompression != 75 {
		t.Fatalf("output_compression = %#v, want 75", payload.OutputCompression)
	}
	if got := response.Assets[0].URL; got != "https://example.test/gpt.png" {
		t.Fatalf("asset url = %q, want image URL", got)
	}
	if response.Usage.TotalTokens != 7 {
		t.Fatalf("usage total = %d, want 7", response.Usage.TotalTokens)
	}
}

func TestGenerateImagesEditsWithReferences(t *testing.T) {
	var authHeader string
	fields := map[string]string{}
	var imageContentType string
	var imageBytes string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/images/edits" {
			t.Fatalf("path = %q, want /v1/images/edits", request.URL.Path)
		}
		reader, err := request.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader() error = %v", err)
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("NextPart() error = %v", err)
			}
			data, err := io.ReadAll(part)
			if err != nil {
				t.Fatalf("ReadAll() error = %v", err)
			}
			if part.FormName() == "image" {
				imageContentType = part.Header.Get("Content-Type")
				imageBytes = string(data)
				continue
			}
			fields[part.FormName()] = string(data)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"created": 1,
			"data": [{"b64_json":"edited-image","revised_prompt":"expanded"}],
			"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		ModelID:       generation.ModelGPTImage2,
		Prompt:        "edit this image",
		ReferenceURLs: []string{"data:image/png;base64,cmVmLWJ5dGVz"},
		Params: map[string]any{
			"size":         "1024x1024",
			"quality":      "medium",
			"outputFormat": "png",
			"n":            float64(1),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if fields["model"] != "gpt-image-2-ssvip" ||
		fields["prompt"] != "edit this image" ||
		fields["size"] != "1024x1024" ||
		fields["quality"] != "medium" ||
		fields["n"] != "1" {
		t.Fatalf("fields = %#v", fields)
	}
	if imageContentType != "image/png" || imageBytes != "ref-bytes" {
		t.Fatalf("image content type = %q bytes = %q, want png ref bytes", imageContentType, imageBytes)
	}
	if got := response.Assets[0].Base64; got != "edited-image" {
		t.Fatalf("asset base64 = %q, want edited-image", got)
	}
}

func TestGenerateGeminiImageWithReference(t *testing.T) {
	var apiKey string
	var payload geminiGenerateContentRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		apiKey = request.Header.Get("x-goog-api-key")
		if request.URL.Path != "/v1beta/models/gemini-3.1-flash-image:generateContent" {
			t.Fatalf("path = %q, want gemini generateContent", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"generated"}}]}}],
			"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		RouteID:       generation.RouteDMXNanoBanana31,
		Prompt:        "edit this image",
		ReferenceURLs: []string{"data:image/jpeg;base64,cmVmLWJ5dGVz"},
		Params: map[string]any{
			"aspectRatio": "16:9",
			"imageSize":   "2K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if apiKey != "sk-test" {
		t.Fatalf("x-goog-api-key = %q, want sk-test", apiKey)
	}
	parts := payload.Contents[0].Parts
	if len(parts) != 2 || parts[0].Text != "edit this image" || parts[1].InlineData == nil {
		t.Fatalf("parts = %#v, want text and inline image", parts)
	}
	if parts[1].InlineData.MIMEType != "image/jpeg" || parts[1].InlineData.Data != "cmVmLWJ5dGVz" {
		t.Fatalf("inline data = %#v, want jpeg reference", parts[1].InlineData)
	}
	if payload.GenerationConfig.ImageConfig.AspectRatio != "16:9" ||
		payload.GenerationConfig.ImageConfig.ImageSize != "2K" {
		t.Fatalf("image config = %#v", payload.GenerationConfig.ImageConfig)
	}
	if len(payload.GenerationConfig.ResponseModalities) != 1 ||
		payload.GenerationConfig.ResponseModalities[0] != "IMAGE" {
		t.Fatalf("response modalities = %#v, want IMAGE", payload.GenerationConfig.ResponseModalities)
	}
	if got := response.Assets[0].Base64; got != "generated" {
		t.Fatalf("asset base64 = %q, want generated", got)
	}
}

func TestGenerateSeedanceResponsesVideo(t *testing.T) {
	var createPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q, want /v1/responses", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&createPayload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"cgt_1",
			"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	created, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteDMXSeedance20Fast,
		Prompt:  "make a video",
		Params: map[string]any{
			"ratio":                 "21:9",
			"resolution":            "720p",
			"duration":              float64(-1),
			"generateAudio":         false,
			"seed":                  float64(123),
			"watermark":             true,
			"returnLastFrame":       true,
			"executionExpiresAfter": float64(3600),
			"negativePrompt":        "should not be sent",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != "dmx.seedance-2.0-fast:cgt_1" {
		t.Fatalf("created id = %q", created.ID)
	}
	if createPayload["model"] != "doubao-seedance-2-0-fast-260128" ||
		createPayload["ratio"] != "21:9" ||
		createPayload["duration"] != float64(-1) ||
		createPayload["generate_audio"] != false ||
		createPayload["seed"] != float64(123) ||
		createPayload["watermark"] != true ||
		createPayload["return_last_frame"] != true ||
		createPayload["execution_expires_after"] != float64(3600) {
		t.Fatalf("payload = %#v", createPayload)
	}
	if _, ok := createPayload["negative_prompt"]; ok {
		t.Fatalf("payload should not include negative_prompt: %#v", createPayload)
	}
}

func TestGenerateVideoAndGetStatus(t *testing.T) {
	var createAuth string
	var queryAuth string
	var createPrompt string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/videos":
			createAuth = request.Header.Get("Authorization")
			reader, err := request.MultipartReader()
			if err != nil {
				t.Fatalf("MultipartReader() error = %v", err)
			}
			createPrompt = readMultipartField(t, reader, "prompt")
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"video_1","object":"video","model":"doubao-seedance-1-0-pro-fast-251015","created_at":1}`))
		case "/v1/videos/video_1":
			queryAuth = request.Header.Get("Authorization")
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{
				"id":"video_1",
				"object":"video",
				"model":"doubao-seedance-1-0-pro-fast-251015",
				"status":"completed",
				"progress":100,
				"video_url":"https://example.test/video.mp4"
			}`))
		default:
			t.Fatalf("unexpected path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	created, err := provider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindVideo,
		Prompt: "make a video",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != "video_1" || created.Status != "submitted" {
		t.Fatalf("created = %#v", created)
	}
	if createAuth != "Bearer sk-test" {
		t.Fatalf("create auth = %q, want Bearer sk-test", createAuth)
	}
	if createPrompt != "make a video" {
		t.Fatalf("prompt = %q, want make a video", createPrompt)
	}

	status, err := provider.Get(context.Background(), "video_1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if queryAuth != "Bearer sk-test" {
		t.Fatalf("query auth = %q, want Bearer sk-test", queryAuth)
	}
	if got := status.Assets[0].URL; got != "https://example.test/video.mp4" {
		t.Fatalf("video URL = %q, want video URL", got)
	}
}

func readMultipartField(t *testing.T, reader *multipart.Reader, fieldName string) string {
	t.Helper()

	for {
		part, err := reader.NextPart()
		if err != nil {
			t.Fatalf("NextPart() error = %v", err)
		}
		if part.FormName() != fieldName {
			continue
		}

		var builder strings.Builder
		if _, err := io.Copy(&builder, part); err != nil {
			t.Fatalf("ReadFrom() error = %v", err)
		}

		return builder.String()
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
