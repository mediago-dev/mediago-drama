package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestDocumentServerRegistersDocumentTools(t *testing.T) {
	server, err := NewDocumentServer(Config{
		ProjectID: "project-test",
		Document: mediamcp.DocumentConfig{
			SessionID:   "session-1",
			RunID:       "run-1",
			BridgeURL:   "http://bridge.test",
			BridgeToken: "token",
		},
	}, testDeps{})
	if err != nil {
		t.Fatalf("creating document server: %v", err)
	}

	tools := listMCPTools(t, server)
	assertMCPTools(t, tools,
		"load_skill",
		"get_project_config",
		"update_project_config",
		"list_comments",
		"get_comment",
		"mutate_comment",
		"ask_user_selection",
		"ask_user_form",
		"await_user_selection",
	)
}

func TestDocumentServerPublishesGenerationIntentInputSchemas(t *testing.T) {
	server, err := NewDocumentServer(Config{
		ProjectID: "project-test",
		Document: mediamcp.DocumentConfig{
			SessionID: "session-1",
			RunID:     "run-1",
		},
	}, testDeps{})
	if err != nil {
		t.Fatalf("creating document server: %v", err)
	}

	schemas := listMCPToolInputSchemaDocuments(t, server)
	for _, toolName := range []string{"ask_user_form", "ask_user_selection"} {
		root, ok := schemas[toolName]
		if !ok {
			t.Fatalf("input schema for %s is missing", toolName)
		}
		intent := requireSchemaProperty(t, root, root, toolName, "intent")
		for _, propertyName := range []string{"version", "operation", "items"} {
			requireSchemaProperty(t, root, intent, toolName+".intent", propertyName)
		}
		items := requireSchemaProperty(t, root, intent, toolName+".intent", "items")
		item := requireSchemaArrayItems(t, root, items, toolName+".intent.items")
		for _, propertyName := range []string{"sessionId", "prompt"} {
			requireSchemaProperty(t, root, item, toolName+".intent.items[]", propertyName)
		}
	}
}

func TestExternalServerRegistersCrossProjectTools(t *testing.T) {
	server, err := NewExternalServer(Config{}, testDeps{})
	if err != nil {
		t.Fatalf("creating external server: %v", err)
	}

	tools := listMCPTools(t, server)
	assertMCPTools(t, tools,
		"list_projects",
		"load_skill",
		"get_project_config",
		"list_comments",
		"get_comment",
		"mutate_comment",
	)
}

func TestGenerationServerRegistersGenerationTools(t *testing.T) {
	server, err := NewGenerationServer(Config{ProjectID: "project-test"}, testDeps{})
	if err != nil {
		t.Fatalf("creating generation server: %v", err)
	}

	tools := listMCPTools(t, server, "生成工作台", "generate_media", "generate_media_batch")
	assertMCPTools(t, tools,
		"generate_media",
		"generate_media_batch",
	)
}

func TestGenerationServerPublishesAuthorizationInputSchemas(t *testing.T) {
	server, err := NewGenerationServer(Config{ProjectID: "project-test"}, testDeps{})
	if err != nil {
		t.Fatalf("creating generation server: %v", err)
	}

	toolSchemas := listMCPToolInputSchemas(t, server)
	assertMCPToolProperties(t, toolSchemas, "generate_media", "confirmationSelectionId", "prompt")
	assertMCPToolProperties(t, toolSchemas, "generate_media_batch", "confirmationSelectionId", "items")
	for _, toolName := range []string{
		"list_generation_models",
		"get_generation_task",
		"list_generation_tasks",
		"retry_generation_task",
		"poll_generation_task",
		"select_generation_asset",
	} {
		if _, ok := toolSchemas[toolName]; ok {
			t.Fatalf("removed generation tool %q still publishes an input schema", toolName)
		}
	}
}

func listMCPTools(t *testing.T, server *mcpsdk.Server, instructionFragments ...string) []string {
	t.Helper()

	if server == nil {
		t.Fatal("server is nil")
	}
	handler := NewStatelessHTTPHandler(func(*http.Request) *mcpsdk.Server {
		return server
	}, nil)
	headers, initialized := callMCP(t, handler, "", 1, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "server-test",
			"version": "0",
		},
	})
	assertMCPInstructions(t, initialized, instructionFragments...)
	sessionID := headers.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("initialize response did not include Mcp-Session-Id")
	}

	_, message := callMCP(t, handler, sessionID, 2, "tools/list", map[string]any{})
	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("tools/list result = %#v, want object", message["result"])
	}
	rawTools, ok := result["tools"].([]any)
	if !ok {
		t.Fatalf("tools = %#v, want array", result["tools"])
	}
	tools := make([]string, 0, len(rawTools))
	for _, item := range rawTools {
		tool, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := tool["name"].(string)
		if name != "" {
			tools = append(tools, name)
		}
	}
	sort.Strings(tools)
	return tools
}

func listMCPToolInputSchemas(t *testing.T, server *mcpsdk.Server) map[string]map[string]any {
	t.Helper()

	documents := listMCPToolInputSchemaDocuments(t, server)
	schemas := make(map[string]map[string]any, len(documents))
	for name, inputSchema := range documents {
		properties, _ := inputSchema["properties"].(map[string]any)
		schemas[name] = properties
	}
	return schemas
}

func listMCPToolInputSchemaDocuments(t *testing.T, server *mcpsdk.Server) map[string]map[string]any {
	t.Helper()

	handler := NewStatelessHTTPHandler(func(*http.Request) *mcpsdk.Server {
		return server
	}, nil)
	headers, _ := callMCP(t, handler, "", 1, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "server-schema-test",
			"version": "0",
		},
	})
	sessionID := headers.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("initialize response did not include Mcp-Session-Id")
	}

	_, message := callMCP(t, handler, sessionID, 2, "tools/list", map[string]any{})
	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("tools/list result = %#v, want object", message["result"])
	}
	rawTools, ok := result["tools"].([]any)
	if !ok {
		t.Fatalf("tools = %#v, want array", result["tools"])
	}

	schemas := make(map[string]map[string]any, len(rawTools))
	for _, rawTool := range rawTools {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			continue
		}
		name, _ := tool["name"].(string)
		inputSchema, _ := tool["inputSchema"].(map[string]any)
		if name != "" {
			schemas[name] = inputSchema
		}
	}
	return schemas
}

func requireSchemaProperty(t *testing.T, root map[string]any, node map[string]any, owner string, propertyName string) map[string]any {
	t.Helper()

	object := resolveSchemaObject(t, root, node, owner)
	properties, ok := object["properties"].(map[string]any)
	if !ok {
		t.Fatalf("%s schema has no properties: %#v", owner, object)
	}
	property, ok := properties[propertyName].(map[string]any)
	if !ok {
		t.Fatalf("%s schema missing %s: %#v", owner, propertyName, properties)
	}
	return property
}

func requireSchemaArrayItems(t *testing.T, root map[string]any, node map[string]any, owner string) map[string]any {
	t.Helper()

	resolved := resolveSchemaReference(t, root, node, owner)
	items, ok := resolved["items"].(map[string]any)
	if !ok {
		t.Fatalf("%s schema has no array items: %#v", owner, resolved)
	}
	return resolveSchemaObject(t, root, items, owner+"[]")
}

func resolveSchemaObject(t *testing.T, root map[string]any, node map[string]any, owner string) map[string]any {
	t.Helper()

	resolved := resolveSchemaReference(t, root, node, owner)
	if _, ok := resolved["properties"].(map[string]any); ok {
		return resolved
	}
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		alternatives, _ := resolved[keyword].([]any)
		for _, alternative := range alternatives {
			candidate, ok := alternative.(map[string]any)
			if !ok {
				continue
			}
			candidate = resolveSchemaReference(t, root, candidate, owner)
			if _, ok := candidate["properties"].(map[string]any); ok {
				return candidate
			}
		}
	}
	t.Fatalf("%s schema does not resolve to an object: %#v", owner, resolved)
	return nil
}

func resolveSchemaReference(t *testing.T, root map[string]any, node map[string]any, owner string) map[string]any {
	t.Helper()

	ref, _ := node["$ref"].(string)
	if ref == "" {
		return node
	}
	const definitionsPrefix = "#/$defs/"
	if !strings.HasPrefix(ref, definitionsPrefix) {
		t.Fatalf("%s schema uses unsupported reference %q", owner, ref)
	}
	definitions, ok := root["$defs"].(map[string]any)
	if !ok {
		t.Fatalf("%s schema references %q without $defs: %#v", owner, ref, root)
	}
	definition, ok := definitions[strings.TrimPrefix(ref, definitionsPrefix)].(map[string]any)
	if !ok {
		t.Fatalf("%s schema definition %q is missing: %#v", owner, ref, definitions)
	}
	return definition
}

func assertMCPToolProperties(t *testing.T, schemas map[string]map[string]any, toolName string, names ...string) {
	t.Helper()

	properties, ok := schemas[toolName]
	if !ok {
		t.Fatalf("input schema for %s is missing", toolName)
	}
	for _, name := range names {
		if _, ok := properties[name]; !ok {
			t.Fatalf("%s input schema missing %s: %#v", toolName, name, properties)
		}
	}
}

func assertMCPInstructions(t *testing.T, message map[string]any, fragments ...string) {
	t.Helper()

	result, ok := message["result"].(map[string]any)
	if !ok {
		t.Fatalf("initialize result = %#v, want object", message["result"])
	}
	instructions, _ := result["instructions"].(string)
	if len(fragments) == 0 {
		fragments = []string{"当前工作目录", "不要再访问或创建名为 work/ 的子目录", "load_skill", "mutate_comment"}
	}
	for _, fragment := range fragments {
		if !strings.Contains(instructions, fragment) {
			t.Fatalf("instructions = %q, want fragment %q", instructions, fragment)
		}
	}
	if strings.Contains(instructions, "get_guidelines") {
		t.Fatalf("instructions = %q, should not mention get_guidelines", instructions)
	}
}

func callMCP(t *testing.T, handler http.Handler, sessionID string, id int, method string, params map[string]any) (http.Header, map[string]any) {
	t.Helper()

	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encoding MCP request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		request.Header.Set("Mcp-Session-Id", sessionID)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("MCP %s status = %d: %s", method, response.Code, response.Body.String())
	}
	message := decodeMCPMessage(t, response.Body.String())
	if rawError, ok := message["error"]; ok {
		t.Fatalf("MCP %s returned error: %#v", method, rawError)
	}
	return response.Result().Header.Clone(), message
}

func decodeMCPMessage(t *testing.T, body string) map[string]any {
	t.Helper()

	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &message); err != nil {
			t.Fatalf("decoding MCP message: %v\nbody: %s", err, body)
		}
		return message
	}
	t.Fatalf("MCP response has no data line: %s", body)
	return nil
}

func assertMCPTools(t *testing.T, tools []string, names ...string) {
	t.Helper()

	expected := append([]string(nil), names...)
	sort.Strings(expected)
	if len(tools) != len(expected) {
		t.Fatalf("tool count = %d, want %d\navailable=%v\nexpected=%v", len(tools), len(expected), tools, expected)
	}
	for index := range tools {
		if tools[index] != expected[index] {
			t.Fatalf("tools mismatch\navailable=%v\nexpected=%v", tools, expected)
		}
	}
}

type testDeps struct{}

func (testDeps) LoadSkill(context.Context, string, mediamcp.LoadSkillInput) (mediamcp.LoadSkillOutput, error) {
	return mediamcp.LoadSkillOutput{}, nil
}

func (testDeps) ListProjects(context.Context) (ProjectList, error) {
	return ProjectList{}, nil
}

func (testDeps) GetProjectConfig(context.Context, string) (mediamcp.ProjectConfigToolOutput, error) {
	return mediamcp.ProjectConfigToolOutput{}, nil
}

func (testDeps) UpdateProjectConfig(context.Context, string, mediamcp.ProjectConfigPatchInput) (mediamcp.ProjectConfigToolOutput, error) {
	return mediamcp.ProjectConfigToolOutput{}, nil
}

func (testDeps) ListComments(context.Context, string, mediamcp.ListCommentsInput) (mediamcp.CommentsToolOutput, error) {
	return mediamcp.CommentsToolOutput{}, nil
}

func (testDeps) GetComment(context.Context, string, mediamcp.GetCommentInput) (mediamcp.CommentToolOutput, error) {
	return mediamcp.CommentToolOutput{}, nil
}

func (testDeps) MutateComment(context.Context, string, mediamcp.MutateCommentInput) (mediamcp.CommentMutationOutput, error) {
	return mediamcp.CommentMutationOutput{}, nil
}

func (testDeps) AskUserSelection(context.Context, string, mediamcp.AskUserSelectionInput) (mediamcp.AskUserSelectionOutput, error) {
	return mediamcp.AskUserSelectionOutput{}, nil
}

func (testDeps) AwaitUserSelection(context.Context, string, mediamcp.AwaitUserSelectionInput) (mediamcp.AskUserSelectionOutput, error) {
	return mediamcp.AskUserSelectionOutput{}, nil
}

func (testDeps) AskUserForm(context.Context, string, mediamcp.AskUserFormInput) (mediamcp.AskUserSelectionOutput, error) {
	return mediamcp.AskUserSelectionOutput{}, nil
}

func (testDeps) CreateGenerationMessage(context.Context, string, mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error) {
	return mediamcp.GenerationMessageOutput{}, nil
}

func (testDeps) CreateGenerationBatch(context.Context, string, mediamcp.GenerationBatchInput) (mediamcp.GenerationBatchOutput, error) {
	return mediamcp.GenerationBatchOutput{}, nil
}
