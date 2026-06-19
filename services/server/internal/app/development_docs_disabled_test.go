//go:build workspace_dist

package app

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDevelopmentDocsRoutesAreDisabledInWorkspaceDist(t *testing.T) {
	handler := newTestHandler(t, filepath.Join(t.TempDir(), "settings.db"))
	appHandler, ok := handler.(*Handler)
	if !ok {
		t.Fatalf("handler type = %T, want *Handler", handler)
	}
	router, ok := appHandler.Handler.(*gin.Engine)
	if !ok {
		t.Fatalf("wrapped handler type = %T, want *gin.Engine", appHandler.Handler)
	}

	for _, route := range router.Routes() {
		if route.Path == "/openapi.json" || strings.HasPrefix(route.Path, "/docs") || strings.HasPrefix(route.Path, "/swagger") {
			t.Fatalf("development docs route registered in workspace_dist build: %s %s", route.Method, route.Path)
		}
	}
}
