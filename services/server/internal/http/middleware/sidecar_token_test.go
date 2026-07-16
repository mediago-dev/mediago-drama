package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSidecarToken(t *testing.T) {
	const token = "sidecar-token-with-at-least-thirty-two-bytes"
	tests := []struct {
		name        string
		expected    string
		provided    string
		wantStatus  int
		wantHandled bool
	}{
		{name: "disabled", wantStatus: http.StatusNoContent, wantHandled: true},
		{name: "matching token", expected: token, provided: token, wantStatus: http.StatusNoContent, wantHandled: true},
		{name: "missing token", expected: token, wantStatus: http.StatusUnauthorized},
		{name: "incorrect token", expected: token, provided: token + "-wrong", wantStatus: http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.ReleaseMode)
			handled := false
			router := gin.New()
			router.Use(SidecarToken(tt.expected, ""))
			router.POST("/mutate", func(context *gin.Context) {
				handled = true
				context.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodPost, "/mutate", nil)
			if tt.provided != "" {
				request.Header.Set(SidecarTokenHeader, tt.provided)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tt.wantStatus)
			}
			if handled != tt.wantHandled {
				t.Fatalf("handled = %v, want %v", handled, tt.wantHandled)
			}
		})
	}
}

func TestSidecarTokenAllowsPreflight(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(SidecarToken("sidecar-token-with-at-least-thirty-two-bytes", ""))
	router.OPTIONS("/mutate", func(context *gin.Context) {
		context.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodOptions, "/mutate", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestSidecarTokenAllowsBridgeTokenOnlyOnInternalRoutes(t *testing.T) {
	const sidecarToken = "sidecar-token-with-at-least-thirty-two-bytes"
	const bridgeToken = "internal-agent-bridge-token"
	tests := []struct {
		name       string
		path       string
		auth       string
		wantStatus int
	}{
		{
			name:       "internal route with bridge token",
			path:       "/api/v1/internal/events/publish",
			auth:       "Bearer " + bridgeToken,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "legacy internal route with bridge token",
			path:       "/api/internal/agent/document-mcp",
			auth:       "Bearer " + bridgeToken,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "public route cannot use bridge token",
			path:       "/api/v1/packs",
			auth:       "Bearer " + bridgeToken,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "internal route rejects wrong bridge token",
			path:       "/api/v1/internal/events/publish",
			auth:       "Bearer wrong",
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.ReleaseMode)
			router := gin.New()
			router.Use(SidecarToken(sidecarToken, bridgeToken))
			router.POST(tt.path, func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodPost, tt.path, nil)
			request.Header.Set("Authorization", tt.auth)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tt.wantStatus)
			}
		})
	}
}
