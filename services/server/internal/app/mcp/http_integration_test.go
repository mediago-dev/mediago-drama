//go:build integration

package mcp_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"testing/fstest"

	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	appserver "github.com/mediago-dev/mediago-drama/services/server/internal/app"
)

const mcpHTTPDocumentContent = "# MCP Doc\n\nFirst paragraph."

func TestExternalMCPHTTPCommentLifecycle(t *testing.T) {
	handler := newMCPHTTPTestHandler(t, "")
	projectID, documentID := createMCPHTTPProjectDocument(t, handler)
	blockID := mcpHTTPParagraphBlockID(t)

	headers, initialized := callMCPHTTP(t, handler, "/mcp", "", "", 1, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "mcp-http-test",
			"version": "0",
		},
	})
	assertMCPInitializeInstructions(t, initialized)
	sessionID := headers.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("initialize response did not include Mcp-Session-Id")
	}

	_, toolsMessage := callMCPHTTP(t, handler, "/mcp", "", sessionID, 2, "tools/list", map[string]any{})
	assertMCPTools(t, toolsMessage, "list_projects", "load_skill", "get_project_config", "list_comments", "get_comment", "mutate_comment")

	_, configMessage := callMCPHTTP(t, handler, "/mcp", "", sessionID, 3, "tools/call", map[string]any{
		"name": "get_project_config",
		"arguments": map[string]any{
			"projectId": projectID,
		},
	})
	config := mcpStructuredContent(t, configMessage)
	if config["status"] != "ok" {
		t.Fatalf("project config result = %#v, want ok", config)
	}
	configBody, ok := config["config"].(map[string]any)
	if !ok || configBody["projectId"] != projectID {
		t.Fatalf("project config = %#v, want projectId %q", config["config"], projectID)
	}

	_, addMessage := callMCPHTTP(t, handler, "/mcp", "", sessionID, 4, "tools/call", map[string]any{
		"name": "mutate_comment",
		"arguments": map[string]any{
			"projectId":  projectID,
			"op":         "add",
			"documentId": documentID,
			"anchor": map[string]any{
				"blockId": blockID,
				"range": map[string]any{
					"start": 0,
					"end":   5,
				},
				"quote": "First",
			},
			"body": "Check paragraph.",
		},
	})
	added := mcpStructuredContent(t, addMessage)
	if added["status"] != "applied" {
		t.Fatalf("add result = %#v, want applied", added)
	}
	thread, ok := added["thread"].(map[string]any)
	if !ok {
		t.Fatalf("thread = %#v, want object", added["thread"])
	}
	root, ok := thread["root"].(map[string]any)
	if !ok || root["id"] == "" {
		t.Fatalf("root = %#v, want id", thread["root"])
	}

	_, listMessage := callMCPHTTP(t, handler, "/mcp", "", sessionID, 5, "tools/call", map[string]any{
		"name": "list_comments",
		"arguments": map[string]any{
			"projectId":  projectID,
			"documentId": documentID,
		},
	})
	listed := mcpStructuredContent(t, listMessage)
	threads, ok := listed["threads"].([]any)
	if !ok || len(threads) != 1 {
		t.Fatalf("threads = %#v, want one thread", listed["threads"])
	}
}

func TestInternalDocumentMCPHTTPAuthAndComments(t *testing.T) {
	const token = "test-bridge-token"
	handler := newMCPHTTPTestHandler(t, token)
	projectID, documentID := createMCPHTTPProjectDocument(t, handler)
	blockID := mcpHTTPParagraphBlockID(t)
	path := mediamcp.DocumentHTTPPath + "?projectId=" + url.QueryEscape(projectID)

	unauthorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
	handler.ServeHTTP(unauthorized, request)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	legacyUnauthorized := httptest.NewRecorder()
	legacyRequest := httptest.NewRequest(http.MethodPost, mediamcp.LegacyDocumentHTTPPath+"?projectId="+url.QueryEscape(projectID), bytes.NewBufferString(`{}`))
	handler.ServeHTTP(legacyUnauthorized, legacyRequest)
	if legacyUnauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("legacy unauthorized status = %d, want %d", legacyUnauthorized.Code, http.StatusUnauthorized)
	}

	headers, initialized := callMCPHTTP(t, handler, path, token, "", 1, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "internal-mcp-http-test",
			"version": "0",
		},
	})
	assertMCPInitializeInstructions(t, initialized)
	sessionID := headers.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("initialize response did not include Mcp-Session-Id")
	}

	_, toolsMessage := callMCPHTTP(t, handler, path, token, sessionID, 2, "tools/list", map[string]any{})
	assertMCPTools(t, toolsMessage, "load_skill", "get_project_config", "update_project_config", "list_comments", "get_comment", "mutate_comment", "ask_user_selection", "ask_user_form", "await_user_selection")

	_, configMessage := callMCPHTTP(t, handler, path, token, sessionID, 3, "tools/call", map[string]any{
		"name":      "get_project_config",
		"arguments": map[string]any{},
	})
	config := mcpStructuredContent(t, configMessage)
	if config["status"] != "ok" {
		t.Fatalf("project config result = %#v, want ok", config)
	}
	configBody, ok := config["config"].(map[string]any)
	if !ok || configBody["projectId"] != projectID {
		t.Fatalf("project config = %#v, want projectId %q", config["config"], projectID)
	}

	_, addMessage := callMCPHTTP(t, handler, path, token, sessionID, 4, "tools/call", map[string]any{
		"name": "mutate_comment",
		"arguments": map[string]any{
			"op":         "add",
			"documentId": documentID,
			"anchor": map[string]any{
				"blockId": blockID,
				"range": map[string]any{
					"start": 0,
					"end":   5,
				},
				"quote": "First",
			},
			"body": "Check internal paragraph.",
		},
	})
	added := mcpStructuredContent(t, addMessage)
	if added["status"] != "applied" {
		t.Fatalf("add result = %#v, want applied", added)
	}

	_, listMessage := callMCPHTTP(t, handler, path, token, sessionID, 5, "tools/call", map[string]any{
		"name": "list_comments",
		"arguments": map[string]any{
			"documentId": documentID,
		},
	})
	listed := mcpStructuredContent(t, listMessage)
	threads, ok := listed["threads"].([]any)
	if !ok || len(threads) != 1 {
		t.Fatalf("threads = %#v, want one thread", listed["threads"])
	}
}

func TestInternalGenerationMCPHTTPAuthAndTools(t *testing.T) {
	const token = "test-bridge-token"
	handler := newMCPHTTPTestHandler(t, token)
	projectID := "project-generation-http"
	path := mediamcp.GenerationHTTPPath + "?projectId=" + url.QueryEscape(projectID)

	unauthorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
	handler.ServeHTTP(unauthorized, request)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	legacyUnauthorized := httptest.NewRecorder()
	legacyRequest := httptest.NewRequest(http.MethodPost, mediamcp.LegacyGenerationHTTPPath+"?projectId="+url.QueryEscape(projectID), bytes.NewBufferString(`{}`))
	handler.ServeHTTP(legacyUnauthorized, legacyRequest)
	if legacyUnauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("legacy unauthorized status = %d, want %d", legacyUnauthorized.Code, http.StatusUnauthorized)
	}

	headers, initialized := callMCPHTTP(t, handler, path, token, "", 1, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "generation-mcp-http-test",
			"version": "0",
		},
	})
	assertGenerationMCPInitializeInstructions(t, initialized)
	sessionID := headers.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("initialize response did not include Mcp-Session-Id")
	}

	_, toolsMessage := callMCPHTTP(t, handler, path, token, sessionID, 2, "tools/list", map[string]any{})
	assertMCPTools(t, toolsMessage,
		"list_generation_models",
		"generate_media",
		"get_generation_task",
		"list_generation_tasks",
		"retry_generation_task",
		"poll_generation_task",
		"select_generation_asset",
	)
}

func assertMCPInitializeInstructions(t *testing.T, message map[string]any) {
	t.Helper()

	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("initialize result = %#v, want object", message["result"])
	}
	instructions, _ := result["instructions"].(string)
	for _, fragment := range []string{
		"当前工作目录",
		"不要再访问或创建名为 work/ 的子目录",
		"不要把整篇内容一次性放进单个 write/edit 工具调用",
		"每次 write/edit 工具参数建议不超过 80 行或 4KB",
		"load_skill",
		"mutate_comment",
	} {
		if !strings.Contains(instructions, fragment) {
			t.Fatalf("instructions = %q, want fragment %q", instructions, fragment)
		}
	}
	if strings.Contains(instructions, "get_guidelines") {
		t.Fatalf("instructions = %q, should not mention get_guidelines", instructions)
	}
}

func assertGenerationMCPInitializeInstructions(t *testing.T, message map[string]any) {
	t.Helper()

	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("initialize result = %#v, want object", message["result"])
	}
	instructions, _ := result["instructions"].(string)
	for _, fragment := range []string{
		"生成工作台",
		"list_generation_models",
		"generate_media",
		"poll_generation_task",
	} {
		if !strings.Contains(instructions, fragment) {
			t.Fatalf("instructions = %q, want fragment %q", instructions, fragment)
		}
	}
}

func newMCPHTTPTestHandler(t *testing.T, token string) http.Handler {
	t.Helper()

	dir := t.TempDir()
	return appserver.NewHandlerWithConfig(
		fstest.MapFS{
			"index.html": {
				Data: []byte("<html>workspace</html>"),
			},
		},
		appserver.Config{
			SettingsDBPath:          filepath.Join(dir, "settings.sqlite"),
			MediaDir:                filepath.Join(dir, "assets"),
			WorkspaceDir:            filepath.Join(dir, "workspace"),
			DisableGenerationWorker: true,
			AgentBridgeToken:        token,
		},
	)
}

func createMCPHTTPProjectDocument(t *testing.T, handler http.Handler) (string, string) {
	t.Helper()

	projectDir := filepath.Join(t.TempDir(), "mcp-http-project")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	projectPayload, err := json.Marshal(map[string]string{
		"name":        "MCP HTTP",
		"description": "smoke",
		"projectDir":  projectDir,
	})
	if err != nil {
		t.Fatalf("encoding project payload: %v", err)
	}
	projectResponse := requestJSON(t, handler, http.MethodPost, "/api/v1/projects", string(projectPayload))
	defer projectResponse.Body.Close()
	if projectResponse.StatusCode != http.StatusOK {
		t.Fatalf("create project status = %d: %s", projectResponse.StatusCode, readBody(t, projectResponse.Body))
	}
	var projectEnvelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(projectResponse.Body).Decode(&projectEnvelope); err != nil {
		t.Fatalf("decoding project response: %v", err)
	}
	if projectEnvelope.Data.ID == "" {
		t.Fatal("created project id is empty")
	}

	documentResponse := requestJSON(
		t,
		handler,
		http.MethodPost,
		"/api/v1/projects/"+url.PathEscape(projectEnvelope.Data.ID)+"/workspace/documents",
		`{"title":"MCP Doc","content":"`+strings.ReplaceAll(mcpHTTPDocumentContent, "\n", "\\n")+`","category":"screenplay"}`,
	)
	defer documentResponse.Body.Close()
	if documentResponse.StatusCode != http.StatusOK {
		t.Fatalf("create document status = %d: %s", documentResponse.StatusCode, readBody(t, documentResponse.Body))
	}
	var documentEnvelope struct {
		Data struct {
			Document struct {
				ID string `json:"id"`
			} `json:"document"`
		} `json:"data"`
	}
	if err := json.NewDecoder(documentResponse.Body).Decode(&documentEnvelope); err != nil {
		t.Fatalf("decoding document response: %v", err)
	}
	if documentEnvelope.Data.Document.ID == "" {
		t.Fatal("created document id is empty")
	}

	return projectEnvelope.Data.ID, documentEnvelope.Data.Document.ID
}

func mcpHTTPParagraphBlockID(t *testing.T) string {
	t.Helper()

	structure, err := docs.ParseStructure(mcpHTTPDocumentContent)
	if err != nil {
		t.Fatalf("parsing test document structure: %v", err)
	}
	for _, block := range docs.FlattenBlocks(structure.Blocks) {
		if block.Kind == "paragraph" {
			return block.ID
		}
	}
	t.Fatalf("structure = %#v, want paragraph", structure.Blocks)
	return ""
}

func requestJSON(t *testing.T, handler http.Handler, method string, target string, body string) *http.Response {
	t.Helper()

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Result()
}

func readBody(t *testing.T, reader io.Reader) string {
	t.Helper()

	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	return string(raw)
}

func callMCPHTTP(
	t *testing.T,
	handler http.Handler,
	path string,
	token string,
	sessionID string,
	id int,
	method string,
	params map[string]any,
) (http.Header, map[string]any) {
	t.Helper()

	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
	}
	if params != nil {
		payload["params"] = params
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encoding MCP request: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if sessionID != "" {
		request.Header.Set("Mcp-Session-Id", sessionID)
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	body := readBody(t, response.Body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("MCP %s status = %d: %s", method, response.StatusCode, body)
	}

	message := decodeMCPHTTPMessage(t, body)
	if rawError, ok := message["error"]; ok {
		t.Fatalf("MCP %s returned error: %#v", method, rawError)
	}
	return response.Header.Clone(), message
}

func decodeMCPHTTPMessage(t *testing.T, body string) map[string]any {
	t.Helper()

	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &message); err != nil {
			t.Fatalf("decoding MCP SSE data: %v\nbody: %s", err, body)
		}
		return message
	}
	t.Fatalf("MCP response has no SSE data line: %s", body)
	return nil
}

func mcpStructuredContent(t *testing.T, message map[string]any) map[string]any {
	t.Helper()

	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("message result = %#v, want object", message["result"])
	}
	content, ok := result["structuredContent"].(map[string]any)
	if !ok {
		t.Fatalf("structuredContent = %#v, want object", result["structuredContent"])
	}
	return content
}

func assertMCPTools(t *testing.T, message map[string]any, names ...string) {
	t.Helper()

	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("message result = %#v, want object", message["result"])
	}
	tools, ok := result["tools"].([]any)
	if !ok {
		t.Fatalf("tools = %#v, want array", result["tools"])
	}
	available := make([]string, 0, len(tools))
	for _, item := range tools {
		tool, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := tool["name"].(string)
		if name != "" {
			available = append(available, name)
		}
	}
	sort.Strings(available)
	expected := append([]string(nil), names...)
	sort.Strings(expected)
	if len(available) != len(expected) {
		t.Fatalf("tool count = %d, want %d\navailable=%v\nexpected=%v", len(available), len(expected), available, expected)
	}
	for index := range expected {
		if available[index] != expected[index] {
			t.Fatalf("tools mismatch\navailable=%v\nexpected=%v", available, expected)
		}
	}
}
