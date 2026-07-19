package mediago

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateChatImageOmitsImageSizeForGemini25(t *testing.T) {
	requestCount := 0
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.Method != http.MethodPost || request.URL.Path != "/chat/completions" {
			t.Errorf("request = %s %s, want POST /chat/completions", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		if got := request.Header.Get("Authorization"); got != "Bearer mgak-test" {
			t.Errorf("Authorization = %q, want Bearer mgak-test", got)
		}
		if got := request.Header.Get("HTTP-Referer"); got != "https://drama.example.test" {
			t.Errorf("HTTP-Referer = %q", got)
		}
		if got := request.Header.Get("X-Title"); got != "mediago-drama" {
			t.Errorf("X-Title = %q", got)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"chat_1",
			"model":"gemini-2.5-flash-image",
			"choices":[{"message":{"images":[{"image_url":{"url":"https://example.test/nano.png"}}]}}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{
		BaseURL:  server.URL,
		APIKey:   "mgak-test",
		AppURL:   "https://drama.example.test",
		AppTitle: "mediago-drama",
	})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana25,
		Prompt:  "draw a cat",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "1K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if requestCount != 1 {
		t.Fatalf("request count = %d, want 1", requestCount)
	}
	if payload["model"] != "gemini-2.5-flash-image" || payload["stream"] != false {
		t.Fatalf("payload = %#v", payload)
	}
	if _, ok := payload["n"]; ok {
		t.Fatalf("MediaGo chat image request must omit n: %#v", payload)
	}
	imageConfig, ok := payload["image_config"].(map[string]any)
	if !ok || imageConfig["aspect_ratio"] != "16:9" {
		t.Fatalf("image_config = %#v", payload["image_config"])
	}
	if _, ok := imageConfig["image_size"]; ok {
		t.Fatalf("Gemini 2.5 MediaGo payload must omit image_size: %#v", imageConfig)
	}
	if response.ID != "chat_1" || response.Model != "gemini-2.5-flash-image" || response.Usage.TotalTokens != 3 {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/nano.png" {
		t.Fatalf("assets = %#v", response.Assets)
	}
}

func TestGenerateRawImageKeepsMainChatCompletionContract(t *testing.T) {
	var requestPath string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestPath = request.URL.Path
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"chat_raw",
			"model":"gemini-3.1-flash-image",
			"choices":[{"message":{"images":[{"image_url":{"url":"https://example.test/raw.png"}}]}}]
		}`))
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindImage,
		Model:  "gemini-3.1-flash-image",
		Prompt: "draw a fox",
		Params: map[string]any{
			"aspectRatio": "4:5",
			"imageSize":   "4K",
			"n":           1,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if requestPath != "/chat/completions" {
		t.Fatalf("request path = %q, want /chat/completions", requestPath)
	}
	if _, ok := payload["n"]; ok {
		t.Fatalf("raw main-compatible chat payload must omit n: %#v", payload)
	}
	if payload["model"] != "gemini-3.1-flash-image" {
		t.Fatalf("payload = %#v", payload)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/raw.png" {
		t.Fatalf("response = %#v", response)
	}
}

func TestGenerateChatImageCombinesConcurrentSingleImageRequests(t *testing.T) {
	const imageCount = 3
	var started atomic.Int32
	release := make(chan struct{})
	var releaseOnce sync.Once

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		if _, ok := payload["n"]; ok {
			t.Errorf("MediaGo chat image single request must omit n: %#v", payload)
		}

		index := started.Add(1)
		if index == imageCount {
			releaseOnce.Do(func() { close(release) })
		}
		select {
		case <-release:
		case <-time.After(2 * time.Second):
			writer.WriteHeader(http.StatusGatewayTimeout)
			return
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, `{
			"id":"chat_%d",
			"model":"gemini-3.1-flash-image",
			"choices":[{"message":{"images":[{"image_url":{"url":"https://example.test/image-%d.png"}}]}}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
		}`, index, index)
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana31,
		Prompt:  "draw three variations",
		Params:  map[string]any{"n": float64(imageCount)},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if started.Load() != imageCount {
		t.Fatalf("request count = %d, want %d", started.Load(), imageCount)
	}
	if len(response.Assets) != imageCount || response.Usage.TotalTokens != 9 {
		t.Fatalf("response = %#v", response)
	}
	if response.Metadata["image_count"] != imageCount {
		t.Fatalf("metadata = %#v", response.Metadata)
	}
	if response.Metadata["requested_image_count"] != imageCount || response.Metadata["failed_image_count"] != 0 {
		t.Fatalf("metadata = %#v", response.Metadata)
	}
}

func TestGenerateChatImageReturnsSuccessfulImagesWhenSomeRequestsFail(t *testing.T) {
	const imageCount = 4
	var started atomic.Int32
	release := make(chan struct{})
	var releaseOnce sync.Once

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		if _, ok := payload["n"]; ok {
			t.Errorf("MediaGo chat image single request must omit n: %#v", payload)
		}

		index := started.Add(1)
		if index == imageCount {
			releaseOnce.Do(func() { close(release) })
		}
		select {
		case <-release:
		case <-time.After(2 * time.Second):
			writer.WriteHeader(http.StatusGatewayTimeout)
			return
		}

		writer.Header().Set("Content-Type", "application/json")
		if index == 1 {
			_, _ = writer.Write([]byte(`{
				"id":"chat_success",
				"model":"gemini-3.1-flash-image",
				"choices":[{"message":{"images":[{"image_url":{"url":"https://example.test/success.png"}}]}}],
				"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
			}`))
			return
		}
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprintf(writer, `{"error":{"message":"upstream failure %d"}}`, index)
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana31,
		Prompt:  "draw four variations",
		Params:  map[string]any{"n": float64(imageCount)},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if started.Load() != imageCount {
		t.Fatalf("request count = %d, want %d", started.Load(), imageCount)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/success.png" {
		t.Fatalf("assets = %#v", response.Assets)
	}
	if response.Usage.TotalTokens != 3 {
		t.Fatalf("usage = %#v", response.Usage)
	}
	if response.Metadata["requested_image_count"] != imageCount ||
		response.Metadata["successful_image_count"] != 1 ||
		response.Metadata["failed_image_count"] != 3 ||
		response.Metadata["partial_success"] != true {
		t.Fatalf("metadata = %#v", response.Metadata)
	}
	failureMessages, ok := response.Metadata["failure_messages"].([]string)
	if !ok || len(failureMessages) != 3 {
		t.Fatalf("failure_messages = %#v", response.Metadata["failure_messages"])
	}
}

func TestGenerateChatImageReturnsRealErrorWhenAllRequestsFail(t *testing.T) {
	const imageCount = 3
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = writer.Write([]byte(`{"error":{"message":"upstream unavailable"}}`))
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	_, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana31,
		Prompt:  "draw three variations",
		Params:  map[string]any{"n": float64(imageCount)},
	})
	if err == nil || !strings.Contains(err.Error(), "upstream unavailable") {
		t.Fatalf("Generate() error = %v, want upstream error", err)
	}
	if requestCount.Load() != imageCount {
		t.Fatalf("request count = %d, want %d", requestCount.Load(), imageCount)
	}
}

func TestGenerateChatImageBatchHonorsParentCancellation(t *testing.T) {
	const imageCount = 3
	var started atomic.Int32
	allStarted := make(chan struct{})
	handlerRelease := make(chan struct{})
	var closeOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		if started.Add(1) == imageCount {
			closeOnce.Do(func() { close(allStarted) })
		}
		select {
		case <-request.Context().Done():
		case <-handlerRelease:
		}
	}))
	t.Cleanup(func() {
		close(handlerRelease)
		server.Close()
	})

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		select {
		case <-allStarted:
			cancel()
		case <-time.After(2 * time.Second):
			cancel()
		}
	}()
	_, err := provider.Generate(ctx, generation.Request{
		RouteID: generation.RouteMediagoNanoBanana31,
		Prompt:  "draw three variations",
		Params:  map[string]any{"n": float64(imageCount)},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Generate() error = %v, want context canceled", err)
	}
	if started.Load() != imageCount {
		t.Fatalf("request count = %d, want %d", started.Load(), imageCount)
	}
}

func TestGenerateChatImageOmitsDefaultImageCount(t *testing.T) {
	tests := []struct {
		name   string
		params map[string]any
	}{
		{name: "missing n"},
		{name: "explicit n equals one", params: map[string]any{"n": float64(1)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var payload map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Errorf("Decode() error = %v", err)
					writer.WriteHeader(http.StatusBadRequest)
					return
				}

				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{
					"id":"chat_1",
					"model":"gemini-2.5-flash-image",
					"choices":[{"message":{"images":[{"image_url":{"url":"https://example.test/nano.png"}}]}}]
				}`))
			}))
			defer server.Close()

			provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
			_, err := provider.Generate(context.Background(), generation.Request{
				RouteID: generation.RouteMediagoNanoBanana25,
				Prompt:  "draw a cat",
				Params:  test.params,
			})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if _, ok := payload["n"]; ok {
				t.Fatalf("default image count must be omitted: %#v", payload)
			}
		})
	}
}

func TestGenerateImagesAPIUsesMediaGoPayload(t *testing.T) {
	var payload map[string]any
	var idempotencyKey string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/images" {
			t.Errorf("request = %s %s, want POST /images", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		if got := request.Header.Get("Authorization"); got != "Bearer mgak-test" {
			t.Errorf("Authorization = %q, want Bearer mgak-test", got)
		}
		idempotencyKey = request.Header.Get(imageResultRecoveryHeader)
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("Decode() error = %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
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

	provider := newTestProvider(t, Config{BaseURL: server.URL, APIKey: "mgak-test"})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoGPTImage2,
		Prompt:  "draw a landscape",
		Params: map[string]any{
			"aspectRatio":       "16:9",
			"resolution":        "2K",
			"quality":           "high",
			"outputFormat":      "webp",
			"outputCompression": float64(60),
			"background":        "opaque",
			"n":                 float64(2),
		},
		ReferenceURLs: []string{"https://example.test/reference.png"},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if !strings.HasPrefix(idempotencyKey, "imgreq_") {
		t.Fatalf("Idempotency-Key = %q, want imgreq_ prefix", idempotencyKey)
	}
	if payload["model"] != "gpt-image-2" || payload["prompt"] != "draw a landscape" {
		t.Fatalf("payload model/prompt = %#v", payload)
	}
	if payload["size"] != "2048x1152" || payload["quality"] != "high" || payload["output_format"] != "webp" || payload["background"] != "opaque" {
		t.Fatalf("image params = %#v", payload)
	}
	if payload["n"] != float64(2) || payload["output_compression"] != float64(60) {
		t.Fatalf("numeric params = %#v", payload)
	}
	if _, ok := payload["provider"]; ok {
		t.Fatalf("MediaGo /images payload must not contain provider options: %#v", payload)
	}
	if _, ok := payload["image_config"]; ok {
		t.Fatalf("MediaGo /images payload must not contain image_config: %#v", payload)
	}
	references, ok := payload["input_references"].([]any)
	if !ok || len(references) != 1 {
		t.Fatalf("input_references = %#v", payload["input_references"])
	}
	if response.ID != "img_1" || response.Model != "gpt-image-2" || response.Usage.TotalTokens != 3 {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Assets) != 1 || response.Assets[0].Base64 != "abc" || response.Assets[0].MIMEType != "image/webp" {
		t.Fatalf("assets = %#v", response.Assets)
	}
	if response.Assets[0].Metadata["revised_prompt"] != "polished" {
		t.Fatalf("asset metadata = %#v", response.Assets[0].Metadata)
	}
}

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

func TestGenerateImagesRecoversAfterClientTimeout(t *testing.T) {
	previousInterval, previousWindow := imageResultRecoveryInterval, imageResultRecoveryWindow
	imageResultRecoveryInterval = 5 * time.Millisecond
	imageResultRecoveryWindow = time.Second
	defer func() {
		imageResultRecoveryInterval, imageResultRecoveryWindow = previousInterval, previousWindow
	}()

	var postedKey atomic.Value
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/images":
			postedKey.Store(request.Header.Get(imageResultRecoveryHeader))
			time.Sleep(150 * time.Millisecond)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"img_sync","data":[{"b64_json":"c3luYw=="}]}`))
		case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/images/results/"):
			key, _ := postedKey.Load().(string)
			if key == "" || request.URL.Path != "/images/results/"+key {
				writer.WriteHeader(http.StatusNotFound)
				return
			}
			writer.Header().Set("Content-Type", "application/json")
			if polls.Add(1) == 1 {
				writer.WriteHeader(http.StatusAccepted)
				_, _ = writer.Write([]byte(`{"status":"pending"}`))
				return
			}
			_, _ = writer.Write([]byte(`{
				"id":"img_recovered",
				"data":[{"b64_json":"cmVjb3ZlcmVk"}],
				"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
			}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{
		BaseURL:    server.URL,
		APIKey:     "mgak-test",
		HTTPClient: &http.Client{Timeout: 30 * time.Millisecond},
	})
	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoGPTImage2,
		Prompt:  "draw a cat",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	key, _ := postedKey.Load().(string)
	if !strings.HasPrefix(key, "imgreq_") {
		t.Fatalf("Idempotency-Key = %q, want imgreq_ prefix", key)
	}
	if polls.Load() < 2 {
		t.Fatalf("recovery polls = %d, want at least 2", polls.Load())
	}
	if response.ID != "img_recovered" || response.Usage.TotalTokens != 3 {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Assets) != 1 || response.Assets[0].Base64 != "cmVjb3ZlcmVk" {
		t.Fatalf("assets = %#v", response.Assets)
	}
}

func TestGenerateImagesReturnsOriginalErrorWhenRecoveryIsUnavailable(t *testing.T) {
	previousInterval, previousWindow := imageResultRecoveryInterval, imageResultRecoveryWindow
	imageResultRecoveryInterval = 5 * time.Millisecond
	imageResultRecoveryWindow = 100 * time.Millisecond
	defer func() {
		imageResultRecoveryInterval, imageResultRecoveryWindow = previousInterval, previousWindow
	}()

	var recoveryPolls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/images":
			time.Sleep(100 * time.Millisecond)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"img_late","data":[]}`))
		case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/images/results/"):
			recoveryPolls.Add(1)
			writer.WriteHeader(http.StatusNotFound)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	provider := newTestProvider(t, Config{
		BaseURL:    server.URL,
		APIKey:     "mgak-test",
		HTTPClient: &http.Client{Timeout: 20 * time.Millisecond},
	})
	_, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoGPTImage2,
		Prompt:  "draw a cat",
	})
	if err == nil {
		t.Fatal("Generate() error = nil, want original transport error")
	}
	if recoveryPolls.Load() != 1 {
		t.Fatalf("recovery polls = %d, want 1 before giving up", recoveryPolls.Load())
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
