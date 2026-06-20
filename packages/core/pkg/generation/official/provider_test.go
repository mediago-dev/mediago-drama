package official

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateOpenAIImage(t *testing.T) {
	var authHeader string
	var payload openAIImagesRequest
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
			"data": [{"b64_json":"abc","revised_prompt":"expanded"}],
			"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{OpenAIBaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOfficialGPTImage2,
		Prompt:  "make an image",
		Params: map[string]any{
			"size":              "1536x1024",
			"quality":           "high",
			"outputCompression": float64(60),
			"background":        "opaque",
			"n":                 float64(2),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload.Model != "gpt-image-2" || payload.Size != "1536x1024" || payload.N != 2 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.OutputCompression == nil || *payload.OutputCompression != 60 || payload.Background != "opaque" {
		t.Fatalf("output settings = compression %#v, background %q", payload.OutputCompression, payload.Background)
	}
	if got := response.Assets[0].Base64; got != "abc" {
		t.Fatalf("asset base64 = %q, want abc", got)
	}
	if response.Usage.TotalTokens != 5 {
		t.Fatalf("usage total = %d, want 5", response.Usage.TotalTokens)
	}
}

func TestGenerateTextStream(t *testing.T) {
	var authHeader string
	var payload officialChatTextRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q, want /v1/chat/completions", request.URL.Path)
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

	provider, err := NewProvider(Config{OpenAIBaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	stream, err := provider.GenerateTextStream(context.Background(), generation.Request{
		Kind:    generation.KindText,
		RouteID: generation.RouteOfficialGPT41MiniText,
		Prompt:  "write",
	})
	if err != nil {
		t.Fatalf("GenerateTextStream() error = %v", err)
	}
	defer stream.Close()

	if authHeader != "Bearer sk-test" {
		t.Fatalf("Authorization = %q, want Bearer sk-test", authHeader)
	}
	if payload.Model != "gpt-4.1-mini" || !payload.Stream || payload.Messages[0].Content != "write" {
		t.Fatalf("payload = %#v", payload)
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

func TestGenerateGoogleImage(t *testing.T) {
	var apiKey string
	var payload googleGenerateContentRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		apiKey = request.Header.Get("x-goog-api-key")
		if request.URL.Path != "/v1beta/models/gemini-3.1-flash-image-preview:generateContent" {
			t.Fatalf("path = %q, want gemini generateContent", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"img"}}]}}],
			"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{GoogleBaseURL: server.URL, APIKey: "gemini-key"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		RouteID:       generation.RouteOfficialNanoBanana31,
		Prompt:        "make an image",
		ReferenceURLs: []string{"data:image/jpeg;base64,cmVmLWJ5dGVz"},
		Params: map[string]any{
			"aspectRatio": "16:9",
			"imageSize":   "2K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if apiKey != "gemini-key" {
		t.Fatalf("x-goog-api-key = %q, want gemini-key", apiKey)
	}
	if payload.GenerationConfig.ResponseFormat.Image.AspectRatio != "16:9" ||
		payload.GenerationConfig.ResponseFormat.Image.ImageSize != "2K" {
		t.Fatalf("generationConfig = %#v", payload.GenerationConfig)
	}
	parts := payload.Contents[0].Parts
	if len(parts) != 2 || parts[0].Text != "make an image" || parts[1].InlineData == nil {
		t.Fatalf("parts = %#v, want prompt and inline reference", parts)
	}
	if parts[1].InlineData.MIMEType != "image/jpeg" || parts[1].InlineData.Data != "cmVmLWJ5dGVz" {
		t.Fatalf("inline data = %#v, want jpeg reference bytes", parts[1].InlineData)
	}
	if got := response.Assets[0].Base64; got != "img" {
		t.Fatalf("asset base64 = %q, want img", got)
	}
}

func TestGenerateMiniMaxSpeech(t *testing.T) {
	var authHeader string
	var payload miniMaxSpeechRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/t2a_v2" {
			t.Fatalf("path = %q, want /v1/t2a_v2", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"data":{"audio":"68656c6c6f","status":2},
			"extra_info":{
				"audio_length":1000,
				"audio_sample_rate":32000,
				"audio_size":5,
				"bitrate":128000,
				"word_count":2,
				"usage_characters":7,
				"audio_format":"mp3",
				"audio_channel":1
			},
			"trace_id":"trace-tts",
			"base_resp":{"status_code":0,"status_msg":"success"}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{MiniMaxBaseURL: server.URL, APIKey: "sk-minimax"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindAudio,
		RouteID: generation.RouteOfficialMiniMaxSpeech28HD,
		Prompt:  "你好，世界",
		Params: map[string]any{
			"voiceId":      "Chinese (Mandarin)_News_Anchor",
			"speed":        1.2,
			"volume":       1.5,
			"pitch":        -1,
			"outputFormat": "mp3",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-minimax" {
		t.Fatalf("Authorization = %q, want Bearer sk-minimax", authHeader)
	}
	if payload.Model != "speech-2.8-hd" || payload.Text != "你好，世界" || payload.Stream {
		t.Fatalf("payload basics = %#v", payload)
	}
	if payload.VoiceSetting.VoiceID != "Chinese (Mandarin)_News_Anchor" ||
		payload.VoiceSetting.Speed != 1.2 ||
		payload.VoiceSetting.Volume != 1.5 ||
		payload.VoiceSetting.Pitch != -1 {
		t.Fatalf("voice setting = %#v", payload.VoiceSetting)
	}
	if payload.OutputFormat != "hex" ||
		payload.AudioSetting.Format != "mp3" ||
		payload.AudioSetting.SampleRate != 32000 ||
		payload.AudioSetting.Bitrate != 128000 {
		t.Fatalf("audio setting = %#v output=%q", payload.AudioSetting, payload.OutputFormat)
	}
	if len(response.Assets) != 1 || response.Assets[0].Kind != generation.KindAudio {
		t.Fatalf("assets = %#v", response.Assets)
	}
	if response.Assets[0].Base64 != "aGVsbG8=" || response.Assets[0].MIMEType != "audio/mpeg" {
		t.Fatalf("audio asset = %#v", response.Assets[0])
	}
	if response.Usage.TotalTokens != 7 {
		t.Fatalf("usage = %#v", response.Usage)
	}
}

func TestNewProviderDefaultsMiniMaxToDomesticEndpoint(t *testing.T) {
	provider, err := NewProvider(Config{APIKey: "sk-minimax"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}
	if provider.miniMaxBaseURL != "https://api.minimaxi.com" {
		t.Fatalf("miniMaxBaseURL = %q, want domestic endpoint", provider.miniMaxBaseURL)
	}
}

func TestGenerateVolcengineImage(t *testing.T) {
	var authHeader string
	var payload volcengineImagesRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/images/generations" {
			t.Fatalf("path = %q, want /images/generations", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"model":"doubao-seedream-5-0-260128",
			"created":1,
			"data":[{"url":"https://example.test/image.png","size":"2048x2048"}],
			"usage":{"generated_images":1,"output_tokens":10,"total_tokens":10}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{VolcengineBaseURL: server.URL, APIKey: "ark-key"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		RouteID:       generation.RouteOfficialSeedream5Lite,
		Prompt:        "make an image",
		ReferenceURLs: []string{"https://example.test/ref.png"},
		Params: map[string]any{
			"size":         "2K",
			"outputFormat": "png",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer ark-key" {
		t.Fatalf("Authorization = %q, want Bearer ark-key", authHeader)
	}
	if payload.Model != "doubao-seedream-5-0-260128" ||
		payload.Size != "2K" ||
		payload.OutputFormat != "png" ||
		payload.SequentialImageGeneration != "disabled" {
		t.Fatalf("payload = %#v", payload)
	}
	if got := response.Assets[0].URL; got != "https://example.test/image.png" {
		t.Fatalf("asset url = %q, want image URL", got)
	}
}

func TestCreateAndGetVolcengineVideo(t *testing.T) {
	var createPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/contents/generations/tasks":
			if err := json.NewDecoder(request.Body).Decode(&createPayload); err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			_, _ = writer.Write([]byte(`{"id":"cgt_1"}`))
		case "/contents/generations/tasks/cgt_1":
			_, _ = writer.Write([]byte(`{
				"id":"cgt_1",
				"model":"doubao-seedance-2-0-fast-260128",
				"status":"succeeded",
				"content":{"video_url":"https://example.test/video.mp4"},
				"usage":{"completion_tokens":7,"total_tokens":7},
				"duration":5,
				"ratio":"16:9",
				"resolution":"720p",
				"generate_audio":true
			}`))
		default:
			t.Fatalf("unexpected path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	provider, err := NewProvider(Config{VolcengineBaseURL: server.URL, APIKey: "ark-key"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	created, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteOfficialSeedance20Fast,
		Prompt:  "make a video",
		Params: map[string]any{
			"ratio":                 "16:9",
			"resolution":            "720p",
			"duration":              float64(5),
			"generateAudio":         true,
			"seed":                  float64(42),
			"returnLastFrame":       true,
			"executionExpiresAfter": float64(3600),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != "official.seedance-2.0-fast:cgt_1" {
		t.Fatalf("created id = %q", created.ID)
	}
	if createPayload["model"] != "doubao-seedance-2-0-fast-260128" ||
		createPayload["ratio"] != "16:9" ||
		createPayload["duration"] != float64(5) ||
		createPayload["generate_audio"] != true ||
		createPayload["seed"] != float64(42) ||
		createPayload["return_last_frame"] != true ||
		createPayload["execution_expires_after"] != float64(3600) {
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
