package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/multimodal"
)

func TestProviderDispatchesByRouteProvider(t *testing.T) {
	var authHeader string
	var payload struct {
		Model string `json:"model"`
		Input string `json:"input"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeader = request.Header.Get("Authorization")
		if request.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q, want /v1/responses", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"resp_1",
			"status":"completed",
			"model":"doubao-seedream-5.0-lite",
			"output":[{"type":"image_url","image_url":{"url":"https://example.test/image.png"}}]
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		DMXBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "sk-dmx", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteDMXSeedream5Lite,
		Prompt:  "make an image",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if authHeader != "sk-dmx" {
		t.Fatalf("Authorization = %q, want sk-dmx", authHeader)
	}
	if payload.Model != "doubao-seedream-5.0-lite" || payload.Input != "make an image" {
		t.Fatalf("payload = %#v", payload)
	}
	if response.Status != "completed" || len(response.Assets) != 1 {
		t.Fatalf("response = %#v, want completed image asset", response)
	}
}

func TestProviderDispatchesMediagoImageRoute(t *testing.T) {
	var credentialKey string
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
			"model":"gemini-2.5-flash-image",
			"choices":[{"message":{"images":[{"type":"image_url","image_url":{"url":"https://example.test/mediago.png"}}]}}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		MediagoBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(_ context.Context, key string) (string, error) {
			credentialKey = key
			return "sk-mediago", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana25,
		Prompt:  "make an image",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"imageSize":   "2K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if credentialKey != generation.ProviderMediago {
		t.Fatalf("credential key = %q, want %q", credentialKey, generation.ProviderMediago)
	}
	if authHeader != "Bearer sk-mediago" {
		t.Fatalf("Authorization = %q, want Bearer sk-mediago", authHeader)
	}
	if payload["model"] != "gemini-2.5-flash-image" {
		t.Fatalf("model = %v", payload["model"])
	}
	if imageConfig, ok := payload["image_config"].(map[string]any); !ok ||
		imageConfig["aspect_ratio"] != "16:9" ||
		imageConfig["image_size"] != "2K" {
		t.Fatalf("image_config = %#v", payload["image_config"])
	}
	if response.Status != "completed" || len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/mediago.png" {
		t.Fatalf("response = %#v, want completed MediaGo image asset", response)
	}
}

func TestProviderDispatchesMediagoGemini31ImageRouteThroughImagesAPI(t *testing.T) {
	var credentialKey string
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
			"model":"gemini-3.1-flash-image",
			"data":[{"url":"https://example.test/mediago-31.png"}],
			"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
		}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		MediagoBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(_ context.Context, key string) (string, error) {
			credentialKey = key
			return "sk-mediago", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteMediagoNanoBanana31,
		Prompt:  "make an image",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "2K",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if credentialKey != generation.ProviderMediago {
		t.Fatalf("credential key = %q, want %q", credentialKey, generation.ProviderMediago)
	}
	if authHeader != "Bearer sk-mediago" {
		t.Fatalf("Authorization = %q, want Bearer sk-mediago", authHeader)
	}
	if payload["model"] != "gemini-3.1-flash-image" {
		t.Fatalf("model = %v", payload["model"])
	}
	if payload["size"] != "2048x1152" {
		t.Fatalf("size = %#v, want 2048x1152", payload["size"])
	}
	if response.Status != "completed" || len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/mediago-31.png" {
		t.Fatalf("response = %#v, want completed MediaGo image asset", response)
	}
}

func TestProviderDispatchesXiaoyunqueRouteThroughPippitCLI(t *testing.T) {
	if goruntime.GOOS == "windows" {
		t.Skip("shell-script fake CLI is only used on Unix-like test hosts")
	}

	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	envPath := filepath.Join(dir, "env.txt")
	binPath := filepath.Join(dir, "pippit-tool-cli")
	script := "#!/bin/sh\n" +
		"printf '%s\n' \"$@\" > \"" + argsPath + "\"\n" +
		"printf '%s\n' \"$XYQ_ACCESS_KEY\" > \"" + envPath + "\"\n" +
		"printf '%s\n' '{\"thread_id\":\"thread_123\",\"run_id\":\"run_456\"}'\n"
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake pippit binary: %v", err)
	}

	var credentialKey string
	provider, err := NewProvider(Config{
		PippitBinPath: binPath,
		Credentials: CredentialResolverFunc(func(_ context.Context, key string) (string, error) {
			credentialKey = key
			return "xyq-key", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteXiaoyunqueSeedance20MiniLite,
		Prompt:  "make a video",
		Params: map[string]any{
			"aspectRatio": "9:16",
			"resolution":  "720p",
			"duration":    "5",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	argsData, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake pippit args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(argsData)), "\n")
	wantArgs := []string{
		"generate-video",
		"--prompt=make a video",
		"--duration=5",
		"--ratio=9:16",
		"--resolution=720p",
		"--model=Seedance_2.0_mini_lite",
	}
	if strings.Join(args, "\n") != strings.Join(wantArgs, "\n") {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
	envData, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("reading fake pippit env: %v", err)
	}
	if credentialKey != generation.ProviderXiaoyunque || strings.TrimSpace(string(envData)) != "xyq-key" {
		t.Fatalf("credential key/env = %q/%q, want Xiaoyunque xyq-key", credentialKey, strings.TrimSpace(string(envData)))
	}
	if response.ID != generation.RouteXiaoyunqueSeedance20MiniLite+":thread_123:run_456" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted Xiaoyunque task", response)
	}
}

func TestProviderDispatchesLibTVRouteThroughCLI(t *testing.T) {
	if goruntime.GOOS == "windows" {
		t.Skip("shell-script fake CLI is only used on Unix-like test hosts")
	}

	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binPath := filepath.Join(dir, "libtv")
	script := "#!/bin/sh\n" +
		"printf '%s\n' \"$@\" > \"" + argsPath + "\"\n" +
		"printf '%s\n' '{\"id\":\"node_123\"}'\n"
	if err := os.WriteFile(binPath, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake libtv binary: %v", err)
	}

	provider, err := NewProvider(Config{
		LibTVBinPath:   binPath,
		LibTVProjectID: "project-123",
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "oauth:ready", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteLibTVSeedance20Mini,
		Prompt:  "make a video",
		Params: map[string]any{
			"aspectRatio":   "9:16",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	argsData, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("reading fake libtv args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(argsData)), "\n")
	for _, want := range []string{
		"node",
		"--project=project-123",
		"create",
		"--type=video",
		"--prompt=make a video",
		"--set=model=Seedance 2.0 Mini",
		"--set=ratio=9:16",
		"--set=resolution=720p",
		"--set=duration=5",
		"--set=enableSound=off",
		"--run",
	} {
		if !containsString(args, want) {
			t.Fatalf("args = %#v, missing %q", args, want)
		}
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":project-123:node_123" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task", response)
	}
}

func TestProviderCachesRouteProviderButResolvesCredentialsEachRequest(t *testing.T) {
	var credentialCalls int
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Header.Get("Authorization") != "sk-dmx" {
			t.Fatalf("Authorization = %q, want sk-dmx", request.Header.Get("Authorization"))
		}

		writeRuntimeSeedreamResponse(writer)
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		DMXBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			credentialCalls++
			return "sk-dmx", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	for range 2 {
		if _, err := provider.Generate(context.Background(), generation.Request{
			RouteID: generation.RouteDMXSeedream5Lite,
			Prompt:  "make an image",
		}); err != nil {
			t.Fatalf("Generate() error = %v", err)
		}
	}

	if credentialCalls != 2 {
		t.Fatalf("credentialCalls = %d, want 2", credentialCalls)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
	if cacheSize := providerCacheSize(provider); cacheSize != 1 {
		t.Fatalf("provider cache size = %d, want 1", cacheSize)
	}
}

func TestProviderCachesCredentialRotationsSeparately(t *testing.T) {
	var credentialCalls int
	authHeaders := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authHeaders = append(authHeaders, request.Header.Get("Authorization"))
		writeRuntimeSeedreamResponse(writer)
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		DMXBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			credentialCalls++
			if credentialCalls == 1 {
				return "sk-one", nil
			}

			return "sk-two", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	for range 2 {
		if _, err := provider.Generate(context.Background(), generation.Request{
			RouteID: generation.RouteDMXSeedream5Lite,
			Prompt:  "make an image",
		}); err != nil {
			t.Fatalf("Generate() error = %v", err)
		}
	}

	if got, want := authHeaders, []string{"sk-one", "sk-two"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("auth headers = %#v, want %#v", got, want)
	}
	if cacheSize := providerCacheSize(provider); cacheSize != 2 {
		t.Fatalf("provider cache size = %d, want 2", cacheSize)
	}
}

func TestProviderRequiresRouteCredential(t *testing.T) {
	provider, err := NewProvider(Config{
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	if _, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteDMXSeedream5Lite,
		Prompt:  "make an image",
	}); err != generation.ErrMissingAPIKey {
		t.Fatalf("Generate() error = %v, want ErrMissingAPIKey", err)
	}
}

func TestProviderAppliesRouteParamsOnceBeforeProviderDispatch(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q, want /v1/responses", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"cgt_1"}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		DMXBaseURL: server.URL,
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "sk-dmx", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteDMXSeedance20Fast,
		Prompt:  "make a video",
		Params: map[string]any{
			"aspectRatio": "21:9",
			"resolution":  "720p",
			"duration":    "-1",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if payload["ratio"] != "21:9" || payload["resolution"] != "720p" || payload["duration"] != float64(-1) {
		t.Fatalf("payload = %#v, want translated vendor params", payload)
	}
	if _, ok := payload["aspectRatio"]; ok {
		t.Fatalf("canonical aspectRatio leaked to provider payload: %#v", payload)
	}
}

func TestProviderRejectsUnsupportedReferenceURLsBeforeCredentials(t *testing.T) {
	credentialCalled := false
	provider, err := NewProvider(Config{
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			credentialCalled = true
			return "sk-test", nil
		}),
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		RouteID:       generation.RouteOfficialGPTImage2,
		Prompt:        "edit this image",
		ReferenceURLs: []string{"https://example.test/reference.png"},
	})
	if err == nil {
		t.Fatal("Generate() accepted unsupported reference URLs")
	}
	if credentialCalled {
		t.Fatal("credential resolver should not be called for a route capability error")
	}
}

func TestProviderDispatchesTextRouteThroughMultimodalFactory(t *testing.T) {
	fake := &fakeMultimodalTextProvider{
		response: multimodal.GenerateResponse{
			Messages: []multimodal.Message{
				{
					Role: multimodal.RoleAssistant,
					Parts: []multimodal.Part{
						{Modality: multimodal.ModalityText, Text: "hello via multimodal"},
					},
				},
			},
			Usage: multimodal.Usage{InputTokens: 1, OutputTokens: 2, TotalTokens: 3},
		},
	}
	var factoryCredentials RouteCredentials
	provider, err := NewProvider(Config{
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "sk-text", nil
		}),
		MultimodalTextProviderFactory: func(
			_ context.Context,
			route generation.ModelRoute,
			credentials RouteCredentials,
		) (multimodal.Provider, error) {
			if route.ID != generation.RouteDMXGPT41MiniText {
				t.Fatalf("route = %q, want %q", route.ID, generation.RouteDMXGPT41MiniText)
			}
			factoryCredentials = credentials
			return fake, nil
		},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		RouteID: generation.RouteDMXGPT41MiniText,
		Prompt:  "write",
		Params: map[string]any{
			"temperature": 0.2,
			"maxTokens":   128,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if got := factoryCredentials[generation.ProviderDMX]; got != "sk-text" {
		t.Fatalf("factory credential = %q, want sk-text", got)
	}
	if fake.request.Options.Model != "gpt-4.1-mini" {
		t.Fatalf("model = %q, want gpt-4.1-mini", fake.request.Options.Model)
	}
	if fake.request.Options.Temperature == nil || *fake.request.Options.Temperature != 0.2 {
		t.Fatalf("temperature = %v, want 0.2", fake.request.Options.Temperature)
	}
	if fake.request.Options.MaxTokens == nil || *fake.request.Options.MaxTokens != 128 {
		t.Fatalf("max tokens = %v, want 128", fake.request.Options.MaxTokens)
	}
	if got := fake.request.Messages[0].Parts[0].Text; got != "write" {
		t.Fatalf("prompt = %q, want write", got)
	}
	if response.Text != "hello via multimodal" || response.Usage.TotalTokens != 3 {
		t.Fatalf("response = %#v", response)
	}
}

func TestProviderStreamsTextRouteThroughMultimodalFactory(t *testing.T) {
	fake := &fakeMultimodalTextProvider{
		stream: []multimodal.StreamEvent{
			{Type: multimodal.StreamEventMessageDelta, Delta: "hel"},
			{Type: multimodal.StreamEventMessageDelta, Delta: "lo"},
			{
				Type:  multimodal.StreamEventDone,
				Usage: &multimodal.Usage{InputTokens: 1, OutputTokens: 2, TotalTokens: 3},
			},
		},
	}
	provider, err := NewProvider(Config{
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "sk-text", nil
		}),
		MultimodalTextProviderFactory: func(
			context.Context,
			generation.ModelRoute,
			RouteCredentials,
		) (multimodal.Provider, error) {
			return fake, nil
		},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	stream, err := provider.GenerateTextStream(context.Background(), generation.Request{
		RouteID: generation.RouteDMXGPT41MiniText,
		Prompt:  "write",
	})
	if err != nil {
		t.Fatalf("GenerateTextStream() error = %v", err)
	}
	defer stream.Close()

	first, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() first error = %v", err)
	}
	second, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() second error = %v", err)
	}
	done, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() done error = %v", err)
	}

	if first.Delta != "hel" || second.Delta != "lo" {
		t.Fatalf("deltas = %q %q, want hel lo", first.Delta, second.Delta)
	}
	if !done.Done || done.Usage == nil || done.Usage.TotalTokens != 3 {
		t.Fatalf("done event = %#v", done)
	}
}

func TestProviderTextStreamReportsUnsupportedForGenerateOnlyMultimodalFactory(t *testing.T) {
	provider, err := NewProvider(Config{
		Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
			return "sk-text", nil
		}),
		MultimodalTextProviderFactory: func(
			context.Context,
			generation.ModelRoute,
			RouteCredentials,
		) (multimodal.Provider, error) {
			return &fakeMultimodalGenerateOnlyProvider{}, nil
		},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.GenerateTextStream(context.Background(), generation.Request{
		RouteID: generation.RouteDMXGPT41MiniText,
		Prompt:  "write",
	})
	if !errors.Is(err, generation.ErrTextStreamingUnsupported) {
		t.Fatalf("GenerateTextStream() error = %v, want ErrTextStreamingUnsupported", err)
	}
}

func TestMultimodalTextProviderMapsRequestOptions(t *testing.T) {
	tests := []struct {
		name          string
		params        map[string]any
		options       map[string]any
		wantTemp      *float32
		wantMaxTokens *int
		wantTopP      *float32
		wantStop      []string
	}{
		{
			name:          "params win",
			params:        map[string]any{"temperature": 0.25, "maxTokens": 64, "topP": 0.8, "stop": []string{"END"}},
			options:       map[string]any{"temperature": 0.9, "maxTokens": 512},
			wantTemp:      float32Ptr(0.25),
			wantMaxTokens: intPtr(64),
			wantTopP:      float32Ptr(0.8),
			wantStop:      []string{"END"},
		},
		{
			name:          "options fallback",
			options:       map[string]any{"temperature": 0.4, "maxTokens": 128, "stop": "STOP"},
			wantTemp:      float32Ptr(0.4),
			wantMaxTokens: intPtr(128),
			wantStop:      []string{"STOP"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeMultimodalTextProvider{}
			provider, err := NewMultimodalTextProvider(fake)
			if err != nil {
				t.Fatalf("NewMultimodalTextProvider() error = %v", err)
			}

			_, err = provider.Generate(context.Background(), generation.Request{
				Kind:    generation.KindText,
				Model:   "gpt-4.1-mini",
				Prompt:  "write",
				Params:  test.params,
				Options: test.options,
			})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}

			assertFloat32Pointer(t, "temperature", fake.request.Options.Temperature, test.wantTemp)
			assertIntPointer(t, "maxTokens", fake.request.Options.MaxTokens, test.wantMaxTokens)
			assertFloat32Pointer(t, "topP", fake.request.Options.TopP, test.wantTopP)
			if strings.Join(fake.request.Options.Stop, ",") != strings.Join(test.wantStop, ",") {
				t.Fatalf("stop = %#v, want %#v", fake.request.Options.Stop, test.wantStop)
			}
		})
	}
}

func providerCacheSize(provider *Provider) int {
	provider.cacheMu.Lock()
	defer provider.cacheMu.Unlock()

	return len(provider.providerCache)
}

func writeRuntimeSeedreamResponse(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", "application/json")
	_, _ = writer.Write([]byte(`{
		"id":"resp_1",
		"status":"completed",
		"model":"doubao-seedream-5.0-lite",
		"output":[{"type":"image_url","image_url":{"url":"https://example.test/image.png"}}]
	}`))
}

func float32Ptr(value float32) *float32 {
	return &value
}

func intPtr(value int) *int {
	return &value
}

func assertFloat32Pointer(t *testing.T, name string, got *float32, want *float32) {
	t.Helper()
	if got == nil || want == nil {
		if got != want {
			t.Fatalf("%s = %v, want %v", name, got, want)
		}
		return
	}
	if *got != *want {
		t.Fatalf("%s = %v, want %v", name, *got, *want)
	}
}

func assertIntPointer(t *testing.T, name string, got *int, want *int) {
	t.Helper()
	if got == nil || want == nil {
		if got != want {
			t.Fatalf("%s = %v, want %v", name, got, want)
		}
		return
	}
	if *got != *want {
		t.Fatalf("%s = %v, want %v", name, *got, *want)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

type fakeMultimodalTextProvider struct {
	request  multimodal.GenerateRequest
	response multimodal.GenerateResponse
	stream   []multimodal.StreamEvent
}

func (provider *fakeMultimodalTextProvider) Name() string {
	return "fake-multimodal"
}

func (provider *fakeMultimodalTextProvider) Generate(
	_ context.Context,
	request multimodal.GenerateRequest,
) (multimodal.GenerateResponse, error) {
	provider.request = request
	return provider.response, nil
}

func (provider *fakeMultimodalTextProvider) Stream(
	_ context.Context,
	request multimodal.GenerateRequest,
) (*multimodal.StreamReader, error) {
	provider.request = request
	return multimodal.StreamFromEvents(provider.stream), nil
}

type fakeMultimodalGenerateOnlyProvider struct{}

func (provider *fakeMultimodalGenerateOnlyProvider) Name() string {
	return "fake-generate-only"
}

func (provider *fakeMultimodalGenerateOnlyProvider) Generate(
	context.Context,
	multimodal.GenerateRequest,
) (multimodal.GenerateResponse, error) {
	return multimodal.GenerateResponse{}, nil
}
