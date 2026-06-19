//go:build !workspace_dist

package app

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDevelopmentDocsRoutes(t *testing.T) {
	handler := newTestHandler(t, filepath.Join(t.TempDir(), "settings.db"))

	response := requestJSON(t, handler, http.MethodGet, openAPIPath, "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("openapi status code = %d, want %d", response.StatusCode, http.StatusOK)
	}

	var document struct {
		Swagger string `json:"swagger"`
		Tags    []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"tags"`
		Paths map[string]map[string]struct {
			Summary     string   `json:"summary"`
			Description string   `json:"description"`
			Tags        []string `json:"tags"`
			Parameters  []struct {
				Name string `json:"name"`
				In   string `json:"in"`
			} `json:"parameters"`
		} `json:"paths"`
		Definitions map[string]json.RawMessage `json:"definitions"`
	}
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		t.Fatalf("decoding openapi document: %v", err)
	}
	if document.Swagger != "2.0" {
		t.Fatalf("swagger version = %q, want 2.0", document.Swagger)
	}
	healthOperation, ok := document.Paths["/api/v1/health"]["get"]
	if !ok {
		t.Fatal("openapi document missing GET /api/v1/health")
	}
	if healthOperation.Summary != "服务健康检查" || len(healthOperation.Tags) != 1 || healthOperation.Tags[0] != "System" {
		t.Fatalf("health operation = %#v, want annotated summary and System tag", healthOperation)
	}
	workspaceOperation, ok := document.Paths["/api/v1/projects/{projectId}/workspace/state"]["get"]
	if !ok {
		t.Fatal("openapi document missing project workspace state route")
	}
	if workspaceOperation.Summary != "获取工作区状态" || !hasParameter(workspaceOperation.Parameters, "projectId", "path") {
		t.Fatalf("workspace operation = %#v, want annotated summary and projectId path param", workspaceOperation)
	}
	if !hasTagDescription(document.Tags, "Projects") || !hasTagDescription(document.Tags, "Generation") || !hasTagDescription(document.Tags, "Agent") {
		t.Fatalf("tags = %#v, want documented Projects, Generation, and Agent groups", document.Tags)
	}
	if _, ok := document.Definitions["handlers.SwaggerEnvelope"]; !ok {
		t.Fatal("swagger document missing response envelope definition")
	}
	if _, ok := document.Paths[openAPIPath]; ok {
		t.Fatal("openapi document should not include its own JSON route")
	}

	assertSwaggerCoversRouter(t, handler, document.Paths)

	swagger := requestJSON(t, handler, http.MethodGet, developmentDocsPath+"/index.html", "")
	defer swagger.Body.Close()
	if swagger.StatusCode != http.StatusOK {
		t.Fatalf("swagger status code = %d, want %d", swagger.StatusCode, http.StatusOK)
	}
	body := readBody(t, swagger.Body)
	if !strings.Contains(body, "Swagger UI") {
		t.Fatalf("swagger body missing expected UI content: %s", body)
	}

	initializer := requestJSON(t, handler, http.MethodGet, developmentDocsPath+"/swagger-initializer.js", "")
	defer initializer.Body.Close()
	if initializer.StatusCode != http.StatusOK {
		t.Fatalf("swagger initializer status code = %d, want %d", initializer.StatusCode, http.StatusOK)
	}
	if initializerBody := readBody(t, initializer.Body); !strings.Contains(initializerBody, openAPIPath) {
		t.Fatalf("swagger initializer missing openapi path: %s", initializerBody)
	}
}

func hasParameter(parameters []struct {
	Name string `json:"name"`
	In   string `json:"in"`
}, name string, in string) bool {
	for _, parameter := range parameters {
		if parameter.Name == name && parameter.In == in {
			return true
		}
	}
	return false
}

func hasTagDescription(tags []struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}, name string) bool {
	for _, tag := range tags {
		if tag.Name == name && strings.TrimSpace(tag.Description) != "" {
			return true
		}
	}
	return false
}

func assertSwaggerCoversRouter(t *testing.T, handler http.Handler, paths map[string]map[string]struct {
	Summary     string   `json:"summary"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Parameters  []struct {
		Name string `json:"name"`
		In   string `json:"in"`
	} `json:"parameters"`
}) {
	t.Helper()
	appHandler, ok := handler.(*Handler)
	if !ok {
		t.Fatalf("handler type = %T, want *Handler", handler)
	}
	router, ok := appHandler.Handler.(*gin.Engine)
	if !ok {
		t.Fatalf("wrapped handler type = %T, want *gin.Engine", appHandler.Handler)
	}

	for _, route := range router.Routes() {
		if isDocsTestRoute(route.Path) || isMCPAnyRoute(route.Path, route.Method) {
			continue
		}
		path := swaggerPath(route.Path)
		method := strings.ToLower(route.Method)
		operation, ok := paths[path][method]
		if !ok {
			t.Fatalf("swagger document missing %s %s", route.Method, path)
		}
		if strings.TrimSpace(operation.Summary) == "" || len(operation.Tags) == 0 {
			t.Fatalf("swagger operation %s %s missing summary or tags: %#v", route.Method, path, operation)
		}
	}
}

func isDocsTestRoute(path string) bool {
	return path == openAPIPath || strings.HasPrefix(path, developmentDocsPath)
}

func isMCPAnyRoute(path string, method string) bool {
	if method == http.MethodPost {
		return false
	}
	return path == "/mcp" ||
		path == "/api/internal/agent/document-mcp" ||
		path == "/api/v1/internal/agent/document-mcp" ||
		strings.HasPrefix(path, "/api/v1/internal/projects/")
}

func swaggerPath(path string) string {
	segments := strings.Split(path, "/")
	for index, segment := range segments {
		if strings.HasPrefix(segment, ":") {
			segments[index] = "{" + strings.TrimPrefix(segment, ":") + "}"
		}
	}
	return strings.Join(segments, "/")
}
