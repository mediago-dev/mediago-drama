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
