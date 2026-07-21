package official

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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

func TestGenerateTextStreamUsesOfficialChatEndpoint(t *testing.T) {
	cases := []struct {
		name    string
		routeID string
		model   string
		path    string
		config  func(string) Config
	}{
		{
			name:    "google",
			routeID: generation.RouteOfficialGemini35FlashText,
			model:   "gemini-3.5-flash",
			path:    "/v1beta/openai/chat/completions",
			config: func(url string) Config {
				return Config{GoogleBaseURL: url, APIKey: "sk-test"}
			},
		},
		{
			name:    "minimax",
			routeID: generation.RouteOfficialMiniMaxM3Text,
			model:   "MiniMax-M3",
			path:    "/v1/chat/completions",
			config: func(url string) Config {
				return Config{MiniMaxBaseURL: url, APIKey: "sk-test"}
			},
		},
		{
			name:    "deepseek",
			routeID: generation.RouteOfficialDeepSeekV4FlashText,
			model:   "deepseek-v4-flash",
			path:    "/chat/completions",
			config: func(url string) Config {
				return Config{DeepSeekBaseURL: url, APIKey: "sk-test"}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var payload officialChatTextRequest
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != tc.path {
					t.Fatalf("path = %q, want %s", request.URL.Path, tc.path)
				}
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Fatalf("Decode() error = %v", err)
				}

				writer.Header().Set("Content-Type", "text/event-stream")
				_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"))
				_, _ = writer.Write([]byte("data: [DONE]\n\n"))
			}))
			defer server.Close()

			provider, err := NewProvider(tc.config(server.URL))
			if err != nil {
				t.Fatalf("NewProvider() error = %v", err)
			}

			stream, err := provider.GenerateTextStream(context.Background(), generation.Request{
				Kind:    generation.KindText,
				RouteID: tc.routeID,
				Prompt:  "write",
			})
			if err != nil {
				t.Fatalf("GenerateTextStream() error = %v", err)
			}
			defer stream.Close()
			if payload.Model != tc.model || !payload.Stream {
				t.Fatalf("payload = %#v, want model %q stream", payload, tc.model)
			}
		})
	}
}

func TestGenerateGoogleImage(t *testing.T) {
	var apiKey string
	var payload googleInteractionRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		apiKey = request.Header.Get("x-goog-api-key")
		if request.URL.Path != "/v1beta/interactions" {
			t.Fatalf("path = %q, want gemini interactions", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"interaction-1",
			"output_image":{"mime_type":"image/png","data":"img"},
			"usage_metadata":{"input_token_count":1,"output_token_count":2,"total_token_count":3}
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
	if payload.Model != "models/gemini-3.1-flash-image" {
		t.Fatalf("model = %q, want models/gemini-3.1-flash-image", payload.Model)
	}
	if payload.ResponseFormat.AspectRatio != "16:9" ||
		payload.ResponseFormat.ImageSize != "2K" ||
		payload.ResponseFormat.Type != "image" ||
		payload.ResponseFormat.MIMEType != "image/jpeg" {
		t.Fatalf("response format = %#v", payload.ResponseFormat)
	}
	if len(payload.Input) != 2 || payload.Input[0].Type != "text" || payload.Input[0].Text != "make an image" {
		t.Fatalf("input = %#v, want prompt and inline reference", payload.Input)
	}
	if payload.Input[1].Type != "image" ||
		payload.Input[1].MIMEType != "image/jpeg" ||
		payload.Input[1].Data != "cmVmLWJ5dGVz" {
		t.Fatalf("image input = %#v, want jpeg reference bytes", payload.Input[1])
	}
	if got := response.Assets[0].Base64; got != "img" {
		t.Fatalf("asset base64 = %q, want img", got)
	}
}

func TestGenerateGoogleImage25OmitsImageSize(t *testing.T) {
	var payload googleInteractionRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1beta/interactions" {
			t.Fatalf("path = %q, want gemini interactions", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"interaction-25",
			"output_image":{"mime_type":"image/png","data":"img"}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{GoogleBaseURL: server.URL, APIKey: "gemini-key"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOfficialNanoBanana25,
		Prompt:  "make an image",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "1K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload.Model != "models/gemini-2.5-flash-image" {
		t.Fatalf("model = %q, want models/gemini-2.5-flash-image", payload.Model)
	}
	if payload.ResponseFormat.AspectRatio != "16:9" {
		t.Fatalf("aspect ratio = %q, want 16:9", payload.ResponseFormat.AspectRatio)
	}
	if payload.ResponseFormat.ImageSize != "" {
		t.Fatalf("image size = %q, want omitted for Gemini 2.5 Flash Image", payload.ResponseFormat.ImageSize)
	}
}

func TestGenerateGoogleImageParsesStepImageURI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"interaction-steps",
			"steps":[
				{"type":"user_input","content":[{"type":"image","uri":"https://example.test/input.png","mime_type":"image/png"}]},
				{"type":"model_output","content":[
					{"type":"text","text":"done"},
					{"type":"image","uri":"https://example.test/generated.png","mime_type":"image/jpeg"}
				]}
			]
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{GoogleBaseURL: server.URL, APIKey: "gemini-key"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOfficialNanoBanana31,
		Prompt:  "make an image",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if len(response.Assets) != 1 {
		t.Fatalf("asset count = %d, want generated model output image only", len(response.Assets))
	}
	if response.Assets[0].URL != "https://example.test/generated.png" ||
		response.Assets[0].MIMEType != "image/jpeg" {
		t.Fatalf("asset = %#v, want generated image URI", response.Assets[0])
	}
	texts, _ := response.Metadata["text"].([]string)
	if len(texts) != 1 || texts[0] != "done" {
		t.Fatalf("texts = %#v, want model output text", response.Metadata["text"])
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

func TestGenerateAliyunWanImage(t *testing.T) {
	var authHeader string
	var payload aliyunWanRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != aliyunWanGenerationPath {
			t.Fatalf("path = %q, want %s", request.URL.Path, aliyunWanGenerationPath)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"status_code":200,
			"request_id":"wan-request-1",
			"output":{"finished":true,"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":[
				{"type":"image","image":"https://example.test/1.png"},
				{"type":"image","image":"https://example.test/2.png"},
				{"type":"image","image":"https://example.test/3.png"},
				{"type":"image","image":"https://example.test/4.png"}
			]}}]},
			"usage":{"input_tokens":10,"output_tokens":8,"total_tokens":18,"image_count":4,"size":"4096*2304"}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{AliyunBaseURL: server.URL, APIKey: "sk-aliyun"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOfficialWan27ImagePro,
		Prompt:  "make four images",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "4K",
			"n":           float64(4),
			"watermark":   true,
			"seed":        float64(42),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "Bearer sk-aliyun" {
		t.Fatalf("Authorization = %q, want Bearer sk-aliyun", authHeader)
	}
	if payload.Model != generation.ModelWan27ImagePro || payload.Parameters.Size != "4096*2304" || payload.Parameters.N != 4 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Parameters.EnableSequential || payload.Parameters.ThinkingMode == nil || !*payload.Parameters.ThinkingMode {
		t.Fatalf("mode params = %#v", payload.Parameters)
	}
	if payload.Parameters.Seed == nil || *payload.Parameters.Seed != 42 {
		t.Fatalf("seed = %#v, want 42", payload.Parameters.Seed)
	}
	if !payload.Parameters.Watermark {
		t.Fatal("watermark = false, want retained backend watermark support")
	}
	if len(payload.Input.Messages) != 1 || len(payload.Input.Messages[0].Content) != 1 || payload.Input.Messages[0].Content[0].Text != "make four images" {
		t.Fatalf("input = %#v", payload.Input)
	}
	if len(response.Assets) != 4 || response.Assets[3].URL != "https://example.test/4.png" {
		t.Fatalf("assets = %#v", response.Assets)
	}
	if response.Usage.TotalTokens != 18 || response.Metadata["image_count"] != 4 {
		t.Fatalf("response usage/metadata = %#v / %#v", response.Usage, response.Metadata)
	}
}

func TestGenerateAliyunWanImageWithReferenceOmitsThinkingMode(t *testing.T) {
	var payload aliyunWanRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"status_code":200,
			"request_id":"wan-edit-1",
			"output":{"finished":true,"choices":[{"message":{"content":[{"type":"image","image":"https://example.test/edited.png"}]}}]},
			"usage":{"image_count":1,"size":"1728*2368"}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{AliyunBaseURL: server.URL, APIKey: "sk-aliyun"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindImage,
		RouteID:       generation.RouteOfficialWan27ImagePro,
		Prompt:        "edit this image",
		ReferenceURLs: []string{"https://example.test/reference.png"},
		Params: map[string]any{
			"aspectRatio": "3:4",
			"resolution":  "2K",
			"n":           float64(1),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload.Parameters.Size != "1728*2368" || payload.Parameters.ThinkingMode != nil {
		t.Fatalf("parameters = %#v", payload.Parameters)
	}
	content := payload.Input.Messages[0].Content
	if len(content) != 2 || content[0].Image != "https://example.test/reference.png" || content[1].Text != "edit this image" {
		t.Fatalf("content = %#v", content)
	}
}

func TestAliyunWanImageValidates4KModes(t *testing.T) {
	tests := []struct {
		name    string
		request generation.Request
		want    string
	}{
		{
			name: "standard model",
			request: generation.Request{
				Model:  generation.ModelWan27Image,
				Prompt: "image",
				Params: map[string]any{"size": "4096*4096", "n": 1},
			},
			want: "does not support 4K",
		},
		{
			name: "reference image",
			request: generation.Request{
				Model:         generation.ModelWan27ImagePro,
				Prompt:        "edit",
				ReferenceURLs: []string{"https://example.test/reference.png"},
				Params:        map[string]any{"size": "4096*2304", "n": 1},
			},
			want: "requires no reference images",
		},
		{
			name: "sequential mode",
			request: generation.Request{
				Model:  generation.ModelWan27ImagePro,
				Prompt: "sequence",
				Params: map[string]any{"size": "2048*2048", "n": 4, "enable_sequential": true},
			},
			want: "sequential image generation is not enabled",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateAliyunWanRequest(test.request)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("validateAliyunWanRequest() error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestAliyunWanImageAllowsLegacyNamedSize(t *testing.T) {
	err := validateAliyunWanRequest(generation.Request{
		Model:         generation.ModelWan27ImagePro,
		Prompt:        "edit",
		ReferenceURLs: []string{"https://example.test/reference.png"},
		Params:        map[string]any{"size": "2K", "n": 1},
	})
	if err != nil {
		t.Fatalf("validateAliyunWanRequest() error = %v, want legacy named size to remain supported", err)
	}
}

func TestAliyunWanSchedulerLimitsConcurrency(t *testing.T) {
	scheduler := newAliyunWanScheduler(aliyunWanSchedulerConfig{
		maxConcurrency: 2,
		maxQueued:      10,
		maxAttempts:    1,
		queueTimeout:   time.Second,
		retryBaseDelay: time.Millisecond,
		retryMaxDelay:  time.Millisecond,
	})

	var active atomic.Int64
	var maxActive atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 6; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			_, err := scheduler.run(context.Background(), func(context.Context) (generation.Response, error) {
				current := active.Add(1)
				for current > maxActive.Load() && !maxActive.CompareAndSwap(maxActive.Load(), current) {
				}
				time.Sleep(20 * time.Millisecond)
				active.Add(-1)
				return generation.Response{}, nil
			})
			if err != nil {
				t.Errorf("run() error = %v", err)
			}
		}()
	}
	waitGroup.Wait()

	if got := maxActive.Load(); got != 2 {
		t.Fatalf("max active = %d, want 2", got)
	}
}

func TestAliyunWanSchedulerSmoothsStarts(t *testing.T) {
	const startInterval = 20 * time.Millisecond
	scheduler := newAliyunWanScheduler(aliyunWanSchedulerConfig{
		maxConcurrency: 5,
		maxQueued:      10,
		maxAttempts:    1,
		queueTimeout:   time.Second,
		startInterval:  startInterval,
		retryBaseDelay: time.Millisecond,
		retryMaxDelay:  time.Millisecond,
	})

	starts := make([]time.Time, 0, 5)
	var startsMu sync.Mutex
	var waitGroup sync.WaitGroup
	for index := 0; index < 5; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			_, err := scheduler.run(context.Background(), func(context.Context) (generation.Response, error) {
				startsMu.Lock()
				starts = append(starts, time.Now())
				startsMu.Unlock()
				return generation.Response{}, nil
			})
			if err != nil {
				t.Errorf("run() error = %v", err)
			}
		}()
	}
	waitGroup.Wait()

	sort.Slice(starts, func(left int, right int) bool { return starts[left].Before(starts[right]) })
	for index := 1; index < len(starts); index++ {
		if gap := starts[index].Sub(starts[index-1]); gap < startInterval-5*time.Millisecond {
			t.Fatalf("start gap %d = %s, want at least %s", index, gap, startInterval-5*time.Millisecond)
		}
	}
}

func TestAliyunWanSchedulerRetriesOnlyRateLimits(t *testing.T) {
	scheduler := newAliyunWanScheduler(aliyunWanSchedulerConfig{
		maxConcurrency: 1,
		maxQueued:      10,
		maxAttempts:    3,
		queueTimeout:   time.Second,
		retryBaseDelay: time.Millisecond,
		retryMaxDelay:  time.Millisecond,
	})

	var attempts atomic.Int64
	_, err := scheduler.run(context.Background(), func(context.Context) (generation.Response, error) {
		if attempts.Add(1) == 1 {
			return generation.Response{}, &generation.HTTPError{
				Provider:   "aliyun",
				StatusCode: http.StatusTooManyRequests,
				Reason:     generation.FailureRateLimited,
				Retryable:  true,
			}
		}
		return generation.Response{}, nil
	})
	if err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("attempts = %d, want 2", got)
	}
}

func TestAliyunWanResponseRateLimitIsRetryable(t *testing.T) {
	err := aliyunWanResponseError(aliyunWanResponse{
		StatusCode: http.StatusTooManyRequests,
		Code:       "Throttling.RateQuota",
		Message:    "Requests rate limit exceeded",
	})

	var httpErr *generation.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("error type = %T, want *generation.HTTPError", err)
	}
	if httpErr.Reason != generation.FailureRateLimited || !httpErr.Retryable {
		t.Fatalf("HTTP error = %#v, want retryable rate limit", httpErr)
	}
	if !isAliyunWanRateLimit(err) {
		t.Fatal("isAliyunWanRateLimit() = false, want true")
	}
}

func TestAliyunWanSchedulersAreSharedAcrossProviderInstances(t *testing.T) {
	first, err := NewProvider(Config{AliyunBaseURL: "https://aliyun.example.test", APIKey: "shared-key"})
	if err != nil {
		t.Fatalf("NewProvider(first) error = %v", err)
	}
	second, err := NewProvider(Config{AliyunBaseURL: "https://aliyun.example.test", APIKey: "shared-key"})
	if err != nil {
		t.Fatalf("NewProvider(second) error = %v", err)
	}

	standard := first.aliyunWanScheduler(generation.ModelWan27Image)
	if standard != second.aliyunWanScheduler(generation.ModelWan27Image) {
		t.Fatal("providers with the same quota identity did not share a scheduler")
	}
	if standard == second.aliyunWanScheduler(generation.ModelWan27ImagePro) {
		t.Fatal("different models unexpectedly shared a scheduler")
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

func TestAliyunHappyHorseReferenceToVideoLifecycle(t *testing.T) {
	var payload aliyunHappyHorseRequest
	var rawPayload map[string]any
	client := &http.Client{Transport: happyHorseRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		responseBody := ""
		switch {
		case request.Method == http.MethodPost && request.URL.Path == aliyunHappyHorseGenerationPath:
			if got := request.Header.Get("Authorization"); got != "Bearer sk-aliyun" {
				t.Fatalf("Authorization = %q, want Bearer sk-aliyun", got)
			}
			if got := request.Header.Get("X-DashScope-Async"); got != "enable" {
				t.Fatalf("X-DashScope-Async = %q, want enable", got)
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll() error = %v", err)
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("Unmarshal(payload) error = %v", err)
			}
			if err := json.Unmarshal(body, &rawPayload); err != nil {
				t.Fatalf("Unmarshal(raw payload) error = %v", err)
			}
			responseBody = `{
				"request_id":"req-create",
				"output":{"task_id":"task-123","task_status":"PENDING"}
			}`
		case request.Method == http.MethodGet && request.URL.Path == aliyunHappyHorseTaskPath+"task-123":
			if got := request.Header.Get("Authorization"); got != "Bearer sk-aliyun" {
				t.Fatalf("Authorization = %q, want Bearer sk-aliyun", got)
			}
			responseBody = `{
				"request_id":"req-status",
				"output":{
					"task_id":"task-123",
					"task_status":"SUCCEEDED",
					"video_url":"https://example.test/happyhorse.mp4"
				},
				"usage":{"duration":6,"input_video_duration":0,"output_video_duration":6,"video_count":1,"SR":1080}
			}`
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Request:    request,
		}, nil
	})}

	provider, err := NewProvider(Config{
		AliyunBaseURL: "https://dashscope.test",
		APIKey:        "sk-aliyun",
		HTTPClient:    client,
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	created, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteOfficialHappyHorse11,
		Prompt:        "让@图片1向镜头挥手",
		ReferenceURLs: []string{"data:image/png;base64,abc"},
		Params: map[string]any{
			"aspectRatio": "9:16",
			"resolution":  "1080p",
			"duration":    "6",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != generation.RouteOfficialHappyHorse11+":task-123" || created.Status != "submitted" {
		t.Fatalf("created response = %#v", created)
	}
	if created.Model != generation.ModelHappyHorse11 || created.Metadata["upstream_model"] != generation.ModelHappyHorse11R2V {
		t.Fatalf("created model/metadata = %q/%#v", created.Model, created.Metadata)
	}
	if payload.Model != generation.ModelHappyHorse11R2V || payload.Input.Prompt != "让[Image 1]向镜头挥手" {
		t.Fatalf("payload model/prompt = %q/%q", payload.Model, payload.Input.Prompt)
	}
	if len(payload.Input.Media) != 1 || payload.Input.Media[0].Type != "reference_image" {
		t.Fatalf("payload media = %#v", payload.Input.Media)
	}
	if payload.Parameters.Resolution != "1080P" || payload.Parameters.Ratio != "9:16" || payload.Parameters.Duration != 6 || payload.Parameters.Watermark {
		t.Fatalf("payload parameters = %#v", payload.Parameters)
	}
	parameters, ok := rawPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("raw parameters = %#v", rawPayload["parameters"])
	}
	if _, ok := parameters["seed"]; ok {
		t.Fatalf("parameters should not include seed: %#v", parameters)
	}

	completed, err := provider.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if completed.Status != "completed" || len(completed.Assets) != 1 {
		t.Fatalf("completed response = %#v", completed)
	}
	if completed.Assets[0].URL != "https://example.test/happyhorse.mp4" {
		t.Fatalf("video URL = %q", completed.Assets[0].URL)
	}
	if completed.Metadata["resolution"] != 1080 || completed.Metadata["video_count"] != 1 {
		t.Fatalf("metadata = %#v", completed.Metadata)
	}
}

type happyHorseRoundTripFunc func(*http.Request) (*http.Response, error)

func (function happyHorseRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestValidateAliyunHappyHorseReferenceRequirements(t *testing.T) {
	references := func(count int) []string {
		values := make([]string, count)
		for index := range values {
			values[index] = "https://example.test/reference.png"
		}
		return values
	}

	tests := []struct {
		name       string
		model      string
		references int
		wantError  string
	}{
		{name: "text to video accepts none", model: generation.ModelHappyHorse11},
		{name: "reference to video accepts one", model: generation.ModelHappyHorse11, references: 1},
		{name: "reference to video accepts nine", model: generation.ModelHappyHorse11, references: 9},
		{name: "reference to video rejects ten", model: generation.ModelHappyHorse11, references: 10, wantError: "at most 9"},
		{name: "image to video is unsupported", model: "happyhorse-1.1-i2v", references: 1, wantError: "unsupported"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateAliyunHappyHorseRequest(generation.Request{
				Model:         test.model,
				ReferenceURLs: references(test.references),
			})
			if test.wantError == "" && err != nil {
				t.Fatalf("validateAliyunHappyHorseRequest() error = %v", err)
			}
			if test.wantError != "" && (err == nil || !strings.Contains(err.Error(), test.wantError)) {
				t.Fatalf("validateAliyunHappyHorseRequest() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestAliyunHappyHorseReferencePayload(t *testing.T) {
	payload := aliyunHappyHorsePayload(generation.Request{
		Model:         generation.ModelHappyHorse11,
		Prompt:        "@图片1看向@image 2",
		ReferenceURLs: []string{"one", "two"},
		Params: map[string]any{
			"ratio":      "9:16",
			"resolution": "720P",
			"duration":   15,
		},
	})

	if payload.Model != generation.ModelHappyHorse11R2V {
		t.Fatalf("model = %q", payload.Model)
	}
	if payload.Input.Prompt != "[Image 1]看向[Image 2]" {
		t.Fatalf("prompt = %q", payload.Input.Prompt)
	}
	if len(payload.Input.Media) != 2 || payload.Input.Media[0].Type != "reference_image" || payload.Input.Media[1].Type != "reference_image" {
		t.Fatalf("media = %#v", payload.Input.Media)
	}
	if payload.Parameters.Ratio != "9:16" || payload.Parameters.Duration != 15 {
		t.Fatalf("parameters = %#v", payload.Parameters)
	}
}

func TestAliyunHappyHorseTextPayload(t *testing.T) {
	payload := aliyunHappyHorsePayload(generation.Request{
		Model:  generation.ModelHappyHorse11,
		Prompt: "一匹马在草原奔跑",
		Params: map[string]any{
			"ratio":      "16:9",
			"resolution": "720P",
			"duration":   5,
		},
	})

	if payload.Model != generation.ModelHappyHorse11T2V {
		t.Fatalf("model = %q", payload.Model)
	}
	if payload.Input.Prompt != "一匹马在草原奔跑" || len(payload.Input.Media) != 0 {
		t.Fatalf("input = %#v", payload.Input)
	}
}
