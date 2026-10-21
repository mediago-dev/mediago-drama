package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Run explicitly with the bundled binary. The local Responses fixture never
// contacts a model service or uses a user's account credentials.
func TestBundledCodexAppServerIntegration(t *testing.T) {
	bin := os.Getenv("MEDIAGO_TEST_CODEX_BIN")
	if bin == "" {
		t.Skip("set MEDIAGO_TEST_CODEX_BIN to test the pinned native distribution")
	}
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"response.created","response":{"id":"resp_fixture","status":"in_progress","output":[]}}`,
			`{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_fixture","role":"assistant","status":"in_progress","content":[]}}`,
			`{"type":"response.content_part.added","item_id":"msg_fixture","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}`,
			`{"type":"response.output_text.delta","item_id":"msg_fixture","output_index":0,"content_index":0,"delta":"native fixture answer"}`,
			`{"type":"response.output_text.done","item_id":"msg_fixture","output_index":0,"content_index":0,"text":"native fixture answer"}`,
			`{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_fixture","role":"assistant","status":"completed","content":[{"type":"output_text","text":"native fixture answer","annotations":[]}]}}`,
			`{"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[{"type":"message","id":"msg_fixture","role":"assistant","content":[{"type":"output_text","text":"native fixture answer","annotations":[]}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer upstream.Close()

	var mcpMu sync.Mutex
	mcpRuns := map[string]bool{}
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("Authorization") != "Bearer local-bridge-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var request struct {
			ID     json.RawMessage
			Method string
			Params struct{ ProtocolVersion string }
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			w.WriteHeader(400)
			return
		}
		if len(request.ID) == 0 {
			w.WriteHeader(202)
			return
		}
		var result any
		switch request.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": request.Params.ProtocolVersion, "capabilities": map[string]any{"tools": map[string]bool{}}, "serverInfo": map[string]string{"name": "local_fixture", "version": "1"}}
			mcpMu.Lock()
			mcpRuns[r.URL.Query().Get("runId")] = true
			mcpMu.Unlock()
		case "tools/list":
			result = map[string]any{"tools": []any{}}
		default:
			result = map[string]any{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}))
	defer bridge.Close()
	root := t.TempDir()
	home := filepath.Join(root, "isolated-home")
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	config := fmt.Sprintf("model = \"gpt-5.4\"\nmodel_provider = \"local_fixture\"\n[model_providers.local_fixture]\nname = \"Local Fixture\"\nbase_url = %q\nwire_api = \"responses\"\nenv_key = \"MEDIAGO_CODEX_FIXTURE_KEY\"\n", upstream.URL)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	r := NewRuntimeAgentRunnerWithDocumentMCPConfigPathAndArgv(bin, root, "", func(AgentRunRequest) string { return "Reply briefly." }, nil, nil)
	defer r.Close()
	r.SetProcessConfigProvider(ProcessConfigProviderFunc(func(context.Context, ProcessConfigRequest) (ProcessConfig, error) {
		return ProcessConfig{ConfigDir: home, Env: map[string]string{"CODEX_HOME": home, "MEDIAGO_CODEX_FIXTURE_KEY": "local-dummy-key"}}, nil
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	req := AgentRunRequest{WorkspaceDir: root, ProjectDir: root, WorkingDir: root, SessionID: "fixture-session", ProjectID: "project-fixture", BridgeURL: bridge.URL, BridgeToken: "local-bridge-token", RunID: "run-1", Prompt: "Say hello"}
	first, err := r.Run(ctx, req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Message != "native fixture answer" || first.CodexThreadID == "" {
		t.Fatalf("first turn %#v", first)
	}
	req.CodexThreadID = first.CodexThreadID
	req.CodexInstructionHash = first.CodexInstructionHash
	req.RunID = "run-2"
	req.Prompt = "Continue"
	second, err := r.Run(ctx, req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.CodexThreadID != first.CodexThreadID || second.Message != "native fixture answer" || calls.Load() != 2 {
		t.Fatalf("resume %#v upstream calls=%d", second, calls.Load())
	}
	mcpMu.Lock()
	defer mcpMu.Unlock()
	if !mcpRuns["run-1"] || !mcpRuns["run-2"] {
		t.Fatalf("native MCP context was not refreshed: %#v", mcpRuns)
	}

}
