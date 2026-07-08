package openrouter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/mediago"
)

func TestGenerateImagesRecoversAfterClientTimeout(t *testing.T) {
	prevInterval, prevWindow := imageResultRecoveryInterval, imageResultRecoveryWindow
	imageResultRecoveryInterval = 10 * time.Millisecond
	imageResultRecoveryWindow = 2 * time.Second
	defer func() {
		imageResultRecoveryInterval, imageResultRecoveryWindow = prevInterval, prevWindow
	}()

	var postedKey atomic.Value
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/images":
			postedKey.Store(r.Header.Get("Idempotency-Key"))
			time.Sleep(300 * time.Millisecond) // outlive the client timeout
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"imggen_sync","data":[{"b64_json":"c3luYw=="}]}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/images/results/"):
			key, _ := postedKey.Load().(string)
			if key == "" || r.URL.Path != "/images/results/"+key {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if polls.Add(1) == 1 {
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"status":"pending"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"imggen_recovered","data":[{"b64_json":"cmVjb3ZlcmVk"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		BaseURL:      server.URL,
		APIKey:       "test-key",
		ProviderName: mediago.Provider,
		HTTPClient:   &http.Client{Timeout: 100 * time.Millisecond},
	})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}

	response, err := provider.generateImages(context.Background(), generation.Request{
		Model:  "gpt-image-2",
		Prompt: "a cat",
	})
	if err != nil {
		t.Fatalf("generateImages: %v", err)
	}
	if response.ID != "imggen_recovered" {
		t.Fatalf("expected recovered response, got id %q", response.ID)
	}
	if len(response.Assets) != 1 || response.Assets[0].Base64 != "cmVjb3ZlcmVk" {
		t.Fatalf("expected recovered base64 asset, got %+v", response.Assets)
	}
	if key, _ := postedKey.Load().(string); !strings.HasPrefix(key, "imgreq_") {
		t.Fatalf("expected Idempotency-Key header on POST, got %q", key)
	}
}

func TestGenerateImagesGivesUpWhenRecoveryUnavailable(t *testing.T) {
	prevInterval, prevWindow := imageResultRecoveryInterval, imageResultRecoveryWindow
	imageResultRecoveryInterval = 10 * time.Millisecond
	imageResultRecoveryWindow = 200 * time.Millisecond
	defer func() {
		imageResultRecoveryInterval, imageResultRecoveryWindow = prevInterval, prevWindow
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/images" {
			time.Sleep(300 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"x","data":[]}`))
			return
		}
		// Recovery endpoint not deployed.
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		BaseURL:      server.URL,
		APIKey:       "test-key",
		ProviderName: mediago.Provider,
		HTTPClient:   &http.Client{Timeout: 100 * time.Millisecond},
	})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}

	_, err = provider.generateImages(context.Background(), generation.Request{
		Model:  "gpt-image-2",
		Prompt: "a cat",
	})
	if err == nil {
		t.Fatal("expected the original transport error to surface")
	}
}

func TestGenerateImagesSkipsRecoveryForNonMediagoProviders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Idempotency-Key") != "" {
			t.Error("unexpected Idempotency-Key header for non-mediago provider")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"imggen_plain","data":[{"b64_json":"cGxhaW4="}]}`))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}

	response, err := provider.generateImages(context.Background(), generation.Request{
		Model:  "some-model",
		Prompt: "a cat",
	})
	if err != nil {
		t.Fatalf("generateImages: %v", err)
	}
	if response.ID != "imggen_plain" {
		t.Fatalf("unexpected response id %q", response.ID)
	}
}
