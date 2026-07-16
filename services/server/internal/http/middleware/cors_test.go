package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIsAllowedLocalOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{name: "vite localhost", origin: "http://127.0.0.1:1420", want: true},
		{name: "electron dev localhost", origin: "http://127.0.0.1:31420", want: true},
		{name: "electron file origin", origin: "file://", want: true},
		{name: "electron app protocol", origin: "app://localhost", want: true},
		{name: "remote site", origin: "https://example.com", want: false},
		{name: "empty", origin: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAllowedLocalOrigin(tt.origin); got != tt.want {
				t.Fatalf("isAllowedLocalOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

func TestLocalCORSExposesEditionHeader(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(LocalCORS(), Edition("commercial"))
	router.GET("/health", func(context *gin.Context) {
		context.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "http://127.0.0.1:31420")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if got := response.Header().Get("Access-Control-Expose-Headers"); got != EditionHeader+", Content-Disposition" {
		t.Fatalf("Access-Control-Expose-Headers = %q, want edition and download headers", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "X-MediaGo-Sidecar-Token") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want sidecar token header", got)
	}
	if got := response.Header().Get(EditionHeader); got != "commercial" {
		t.Fatalf("%s = %q, want commercial", EditionHeader, got)
	}
}

func TestLocalCORSRejectsRemoteBrowserOrigin(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	called := false
	router := gin.New()
	router.Use(LocalCORS())
	router.POST("/mutate", func(context *gin.Context) {
		called = true
		context.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/mutate", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if called {
		t.Fatal("remote browser request reached the route handler")
	}
}

func TestLocalCORSAllowsRequestsWithoutBrowserOrigin(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(LocalCORS())
	router.GET("/health", func(context *gin.Context) {
		context.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}
