package mediago

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateTextConsumesMediaGoSSE(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/chat/completions" {
			t.Errorf("request = %s %s, want POST /chat/completions", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		if got := request.Header.Get("Accept"); got != "" {
			t.Errorf("Accept = %q, want legacy request with no explicit Accept header", got)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer mgak-test" {
			t.Errorf("Authorization = %q, want Bearer mgak-test", got)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"MediaGo\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoGPT54MiniText,
		Prompt:  "say hello",
		Params: map[string]any{
			"temperature": 0.2,
			"maxTokens":   float64(128),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload["model"] != "gpt-5.4-mini" || payload["stream"] != true {
		t.Fatalf("payload = %#v", payload)
	}
	if payload["temperature"] != 0.2 || payload["max_tokens"] != float64(128) {
		t.Fatalf("text params = %#v", payload)
	}
	streamOptions, ok := payload["stream_options"].(map[string]any)
	if !ok || streamOptions["include_usage"] != true {
		t.Fatalf("stream_options = %#v", payload["stream_options"])
	}
	if response.Text != "hello MediaGo" || response.Usage.TotalTokens != 5 {
		t.Fatalf("response = %#v", response)
	}
}

func TestGenerateAndGetVideo(t *testing.T) {
	var createPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "Bearer mgak-test" {
			t.Errorf("Authorization = %q, want Bearer mgak-test", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/videos":
			if err := json.NewDecoder(request.Body).Decode(&createPayload); err != nil {
				t.Errorf("Decode() error = %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = writer.Write([]byte(`{"id":"video_1","status":"queued"}`))
		case request.Method == http.MethodGet && request.URL.Path == "/videos/video_1":
			_, _ = writer.Write([]byte(`{
				"id":"video_1",
				"status":"completed",
				"model":"happyhorse-1.1-r2v",
				"unsigned_urls":["https://example.test/happyhorse.mp4"]
			}`))
		default:
			t.Errorf("unexpected request = %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	created, err := provider.Generate(context.Background(), generation.Request{
		RouteID:       generation.RouteMediagoHappyHorse11,
		Prompt:        "animate the character",
		ReferenceURLs: []string{"https://example.test/reference.png"},
		Params: map[string]any{
			"aspectRatio": "9:16",
			"resolution":  "1080p",
			"duration":    "6",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if createPayload["model"] != generation.ModelHappyHorse11R2V || createPayload["aspect_ratio"] != "9:16" || createPayload["resolution"] != "1080p" {
		t.Fatalf("create payload = %#v", createPayload)
	}
	if createPayload["duration"] != float64(6) {
		t.Fatalf("duration = %#v, want 6", createPayload["duration"])
	}
	references, ok := createPayload["input_references"].([]any)
	if !ok || len(references) != 1 {
		t.Fatalf("input_references = %#v", createPayload["input_references"])
	}
	if created.ID != generation.RouteMediagoHappyHorse11+":video_1" || created.Status != "pending" {
		t.Fatalf("created = %#v", created)
	}

	completed, err := provider.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if completed.Status != "completed" || completed.Model != generation.ModelHappyHorse11R2V {
		t.Fatalf("completed = %#v", completed)
	}
	if len(completed.Assets) != 1 || completed.Assets[0].URL != "https://example.test/happyhorse.mp4" {
		t.Fatalf("assets = %#v", completed.Assets)
	}
}

func newTestProvider(t *testing.T, config Config) *Provider {
	t.Helper()
	provider, err := NewProvider(config)
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}
	return provider
}
