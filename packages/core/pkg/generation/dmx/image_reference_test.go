package dmx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

func TestImageReferenceDataRejectsNonImageHTTPContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain")
		_, _ = writer.Write([]byte("not an image"))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, _, err = provider.imageReferenceData(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "not an image") {
		t.Fatalf("imageReferenceData() error = %v, want non-image content type", err)
	}
}

func TestImageReferenceDataRejectsOversizedHTTPReference(t *testing.T) {
	withReferenceImageByteLimit(t, 4)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "image/png")
		_, _ = writer.Write([]byte("12345"))
	}))
	defer server.Close()

	provider, err := NewProvider(Config{BaseURL: server.URL, APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, _, err = provider.imageReferenceData(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("imageReferenceData() error = %v, want oversized image error", err)
	}
}

func TestDecodeDataURIRejectsNonImageMIMEType(t *testing.T) {
	_, _, err := decodeDataURI("data:text/plain;base64,MTIz")
	if err == nil || !strings.Contains(err.Error(), "not an image") {
		t.Fatalf("decodeDataURI() error = %v, want non-image content type", err)
	}
}

func TestDecodeDataURIRejectsOversizedReference(t *testing.T) {
	withReferenceImageByteLimit(t, 4)

	_, _, err := decodeDataURI("data:image/png;base64,MTIzNDU=")
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("decodeDataURI() error = %v, want oversized image error", err)
	}
}

func withReferenceImageByteLimit(t *testing.T, limit int64) {
	t.Helper()

	previous := adapterutil.ReferenceImageByteLimit
	adapterutil.ReferenceImageByteLimit = limit
	t.Cleanup(func() {
		adapterutil.ReferenceImageByteLimit = previous
	})
}
