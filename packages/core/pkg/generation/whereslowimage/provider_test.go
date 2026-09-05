package whereslowimage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGeminiPreservesConfiguredModelAndEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1beta/models/nano-banana-2:generateContent" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Get("key") != "secret" {
			t.Fatal("custom API key query parameter is missing")
		}
		if request.Header.Get("Authorization") != "" || request.Header.Get("x-goog-api-key") != "" {
			t.Fatal("Gemini API key must not be duplicated into request headers")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		generationConfig, ok := body["generationConfig"].(map[string]any)
		if !ok {
			t.Fatalf("generationConfig = %#v", body["generationConfig"])
		}
		modalities, ok := generationConfig["responseModalities"].([]any)
		if !ok || len(modalities) != 1 || modalities[0] != "IMAGE" {
			t.Fatalf("responseModalities = %#v", generationConfig["responseModalities"])
		}
		imageConfig, ok := generationConfig["imageConfig"].(map[string]any)
		if !ok {
			t.Fatalf("imageConfig = %#v", generationConfig["imageConfig"])
		}
		if imageConfig["aspectRatio"] != "16:9" {
			t.Fatalf("aspectRatio = %#v", imageConfig["aspectRatio"])
		}
		if imageConfig["imageSize"] != "4K" {
			t.Fatalf("imageSize = %#v", imageConfig["imageSize"])
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "secret", Protocol: ProtocolGemini})
	if err != nil {
		t.Fatal(err)
	}
	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindImage,
		Model:  "nano-banana-2",
		Prompt: "draw",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "4K",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Model != "nano-banana-2" || len(response.Assets) != 1 {
		t.Fatalf("response = %#v", response)
	}
}

func TestConfiguredGeminiEndpointIsLiteralAndCredentialFree(t *testing.T) {
	got := Endpoint("https://cn.whereslow.online", "nano-banana-2", ProtocolGemini)
	want := "https://cn.whereslow.online/v1beta/models/nano-banana-2:generateContent"
	if got != want {
		t.Fatalf("endpoint = %q, want %q", got, want)
	}
	for _, forbidden := range []string{"mediago.torchstellar.com", "gemini-3-pro-image", "gemini-3.1-pro-image", "nano-banana-pro", "?key="} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("endpoint contains forbidden value %q: %s", forbidden, got)
		}
	}
}

func TestHTTPErrorCarriesProviderModelAndStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusServiceUnavailable)
		_, _ = writer.Write([]byte(`{"error":{"code":"upstream_busy","message":"try later"}}`))
	}))
	defer server.Close()
	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "secret", Protocol: ProtocolGemini})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Generate(context.Background(), generation.Request{Kind: generation.KindImage, Model: "nano-banana-2", Prompt: "draw"})
	if err == nil {
		t.Fatal("expected error")
	}
	failure, ok := generation.FailureFromError(err)
	wantEndpoint := server.URL + "/v1beta/models/nano-banana-2:generateContent"
	if !ok || failure.Provider != generation.ProviderWhereslowImage || failure.Model != "nano-banana-2" || failure.Endpoint != wantEndpoint || failure.StatusCode != http.StatusServiceUnavailable || failure.Message != "try later" {
		t.Fatalf("failure = %#v", failure)
	}
	if strings.Contains(err.Error(), "secret") || strings.Contains(failure.Raw, "secret") {
		t.Fatal("API key leaked into error")
	}
}

func TestParseGeminiResponseTraversesAllCandidatesAndParts(t *testing.T) {
	tests := []struct {
		name     string
		payload  string
		mimeType string
		assets   int
	}{
		{
			name:     "single camel case PNG",
			payload:  `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`,
			mimeType: "image/png",
			assets:   1,
		},
		{
			name:     "text before JPEG image",
			payload:  `{"candidates":[{"content":{"parts":[{"text":"done"},{"inlineData":{"mimeType":"image/jpeg","data":"/9j/2Q=="}}]}}]}`,
			mimeType: "image/jpeg",
			assets:   1,
		},
		{
			name:     "multiple candidates",
			payload:  `{"candidates":[{"content":{"parts":[{"text":"first"}]}},{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}},{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"/9j/2Q=="}}]}}]}`,
			mimeType: "image/png",
			assets:   2,
		},
		{
			name:     "snake case inline data",
			payload:  `{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/webp","data":"UklGRg=="}}]}}]}`,
			mimeType: "image/webp",
			assets:   1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, err := parseGeminiResponse(json.RawMessage(test.payload), "nano-banana-2")
			if err != nil {
				t.Fatal(err)
			}
			if len(response.Assets) != test.assets {
				t.Fatalf("assets = %d, want %d", len(response.Assets), test.assets)
			}
			if response.Assets[0].MIMEType != test.mimeType {
				t.Fatalf("mime type = %q, want %q", response.Assets[0].MIMEType, test.mimeType)
			}
		})
	}
}

func TestParseGeminiResponseRejectsTextOnlyAndInvalidBase64(t *testing.T) {
	_, err := parseGeminiResponse(
		json.RawMessage(`{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"unable to create image"}]}}]}`),
		"nano-banana-2",
	)
	if err == nil || !strings.Contains(err.Error(), "WhereSlow response contained no extractable image") || !strings.Contains(err.Error(), "finishReason=STOP") {
		t.Fatalf("text-only error = %v", err)
	}

	_, err = parseGeminiResponse(
		json.RawMessage(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"not-base64!"}}]}}]}`),
		"nano-banana-2",
	)
	if err == nil || !strings.Contains(err.Error(), "invalid base64") {
		t.Fatalf("invalid-base64 error = %v", err)
	}
}

func TestNormalizeAspectRatioPreservesFrontendOptions(t *testing.T) {
	for _, value := range []string{
		"21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16",
		"1:4", "1:3", "4:1", "4:5", "5:4", "8:1", "9:21",
	} {
		if got := wsNormalizeAspectRatio(value); got != value {
			t.Errorf("wsNormalizeAspectRatio(%q) = %q", value, got)
		}
	}
}
