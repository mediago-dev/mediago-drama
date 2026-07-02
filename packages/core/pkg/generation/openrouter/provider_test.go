package openrouter

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateImage(t *testing.T) {
	var authHeader string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q, want /chat/completions", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"chat_1",
			"model":"google/gemini-3.1-flash-image-preview",
			"choices":[{"message":{"images":[{"type":"image_url","image_url":{"url":"data:image/png;base64,abc"}}]}}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOpenRouterNanoBanana31,
		Prompt:  "make an image",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "2K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload["model"] != "google/gemini-3.1-flash-image-preview" {
		t.Fatalf("model = %v", payload["model"])
	}
	imageConfig, ok := payload["image_config"].(map[string]any)
	if !ok || imageConfig["aspect_ratio"] != "16:9" || imageConfig["image_size"] != "2K" {
		t.Fatalf("image_config = %#v", payload["image_config"])
	}
	if got := response.Assets[0].URL; got != "data:image/png;base64,abc" {
		t.Fatalf("asset url = %q, want image URL", got)
	}
	if response.Usage.TotalTokens != 3 {
		t.Fatalf("usage total = %d, want 3", response.Usage.TotalTokens)
	}
}

func TestGenerateImagesAPI(t *testing.T) {
	var authHeader string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/images" {
			t.Fatalf("path = %q, want /images", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"img_1",
			"model":"gpt-image-2",
			"created":123,
			"data":[{"b64_json":"abc","media_type":"image/webp","revised_prompt":"polished"}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"cost":0.01}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		BaseURL:      server.URL,
		APIKey:       "sk-test",
		ProviderName: generation.ProviderMediago,
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteMediagoGPTImage2,
		Prompt:  "make an image",
		Params: map[string]any{
			"aspectRatio":       "16:9",
			"resolution":        "2K",
			"size":              "2048x1152",
			"quality":           "high",
			"outputFormat":      "webp",
			"outputCompression": float64(60),
			"moderation":        "low",
			"background":        "opaque",
			"n":                 float64(2),
		},
		ReferenceURLs: []string{"https://example.test/reference.png"},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload["model"] != "gpt-image-2" || payload["prompt"] != "make an image" {
		t.Fatalf("payload model/prompt = %#v", payload)
	}
	if payload["size"] != "2048x1152" || payload["quality"] != "high" || payload["output_format"] != "webp" || payload["background"] != "opaque" {
		t.Fatalf("image params = %#v", payload)
	}
	if payload["n"] != float64(2) || payload["output_compression"] != float64(60) {
		t.Fatalf("numeric params = %#v", payload)
	}
	if _, ok := payload["image_config"]; ok {
		t.Fatalf("images API payload should not include image_config: %#v", payload)
	}
	if _, ok := payload["aspectRatio"]; ok {
		t.Fatalf("canonical aspectRatio leaked: %#v", payload)
	}
	references, ok := payload["input_references"].([]any)
	if !ok || len(references) != 1 {
		t.Fatalf("input_references = %#v", payload["input_references"])
	}
	if _, ok := payload["provider"]; ok {
		t.Fatalf("mediago images payload should not include provider options: %#v", payload)
	}
	if response.ID != "img_1" || response.Model != "gpt-image-2" || response.Usage.TotalTokens != 3 {
		t.Fatalf("response = %#v", response)
	}
	if got := response.Assets[0].Base64; got != "abc" {
		t.Fatalf("asset base64 = %q, want abc", got)
	}
	if response.Assets[0].MIMEType != "image/webp" {
		t.Fatalf("asset MIMEType = %q, want image/webp", response.Assets[0].MIMEType)
	}
	if response.Assets[0].Metadata["revised_prompt"] != "polished" {
		t.Fatalf("asset metadata = %#v", response.Assets[0].Metadata)
	}
}

func TestGenerateTextStream(t *testing.T) {
	var authHeader string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q, want /chat/completions", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n"))
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
		RouteID: generation.RouteOpenRouterGPT41MiniText,
		Prompt:  "write",
		Params: map[string]any{
			"temperature": float64(0.2),
			"maxTokens":   float64(128),
		},
	})
	if err != nil {
		t.Fatalf("GenerateTextStream() error = %v", err)
	}
	defer stream.Close()

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload["model"] != "openai/gpt-4.1-mini" || payload["stream"] != true {
		t.Fatalf("payload = %#v", payload)
	}
	if payload["temperature"] != 0.2 || payload["max_tokens"] != float64(128) {
		t.Fatalf("params = %#v", payload)
	}

	event, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() error = %v", err)
	}
	if event.Delta != "hello" {
		t.Fatalf("delta = %q, want hello", event.Delta)
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

func TestGenerateVideoAndGetStatus(t *testing.T) {
	var createPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/video/generations":
			if err := json.NewDecoder(request.Body).Decode(&createPayload); err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			writer.WriteHeader(http.StatusAccepted)
			_, _ = writer.Write([]byte(`{"id":"video_1","polling_url":"https://example.test/videos/video_1","status":"pending"}`))
		case "/videos/video_1":
			_, _ = writer.Write([]byte(`{
				"id":"video_1",
				"generation_id":"gen_1",
				"status":"completed",
				"model":"bytedance/seedance-2.0-fast",
				"unsigned_urls":["https://example.test/video.mp4"]
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
		Kind:    generation.KindVideo,
		RouteID: generation.RouteOpenRouterSeedance20Fast,
		Prompt:  "make a video",
		Params: map[string]any{
			"aspectRatio":   "9:16",
			"resolution":    "1080p",
			"duration":      float64(8),
			"generateAudio": true,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != "openrouter.seedance-2.0-fast:video_1" || created.Status != "submitted" {
		t.Fatalf("created = %#v", created)
	}
	if createPayload["model"] != "bytedance/seedance-2.0-fast" ||
		createPayload["aspect_ratio"] != "9:16" ||
		createPayload["duration"] != float64(8) ||
		createPayload["generate_audio"] != true {
		t.Fatalf("payload = %#v", createPayload)
	}

	status, err := provider.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if status.Status != "completed" {
		t.Fatalf("status = %q, want completed", status.Status)
	}
	if got := status.Assets[0].URL; got != "https://example.test/video.mp4" {
		t.Fatalf("video URL = %q, want video URL", got)
	}
}
