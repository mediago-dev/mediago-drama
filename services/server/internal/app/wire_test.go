package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mediago-dev/mediago-drama/services/server/internal/http/middleware"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceacp "github.com/mediago-dev/mediago-drama/services/server/internal/service/acp"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

func TestNewHandlerRequiresSidecarToken(t *testing.T) {
	const token = "sidecar-token-with-at-least-thirty-two-bytes"
	workspaceDir := filepath.Join(t.TempDir(), "workspace")
	handler := NewHandlerWithConfig(
		fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
		Config{
			WorkspaceDir:            workspaceDir,
			SidecarToken:            token,
			AgentBridgeToken:        "agent-bridge-token",
			DisableGenerationWorker: true,
			DisableWorkspaceWatcher: true,
			agentRunner:             fakeAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	if closer, ok := handler.(interface{ Close() error }); ok {
		t.Cleanup(func() { _ = closer.Close() })
	}

	missing := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	missingResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingResponse, missing)
	if missingResponse.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d, want %d", missingResponse.Code, http.StatusUnauthorized)
	}

	authorized := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	authorized.Header.Set(middleware.SidecarTokenHeader, token)
	authorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResponse, authorized)
	if authorizedResponse.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d", authorizedResponse.Code, http.StatusOK)
	}
}

func TestNewHandlerDefaultsSettingsDBToWorkspaceDatabaseDir(t *testing.T) {
	workspaceDir := filepath.Join(t.TempDir(), "workspace")
	paths := serviceshared.WorkspacePathsFor(workspaceDir)
	legacyRepos, err := repository.OpenSettingsRepositories(paths.DatabasePath())
	if err != nil {
		t.Fatalf("opening legacy settings database: %v", err)
	}
	if err := legacyRepos.APIKeys.Set("openrouter", "sk-legacy-settings"); err != nil {
		t.Fatalf("writing legacy API key: %v", err)
	}

	handler := NewHandlerWithConfig(
		fstest.MapFS{
			"index.html": {
				Data: []byte("<html>workspace</html>"),
			},
		},
		Config{
			WorkspaceDir:            workspaceDir,
			ModelPlatforms:          []string{"openrouter"},
			DisableGenerationWorker: true,
			DisableWorkspaceWatcher: true,
			agentRunner:             fakeAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	if closer, ok := handler.(interface{ Close() error }); ok {
		t.Cleanup(func() {
			if err := closer.Close(); err != nil {
				t.Fatalf("closing handler: %v", err)
			}
		})
	}

	if paths.SettingsDatabasePath() == paths.DatabasePath() {
		t.Fatalf("settings database path should be separate from workspace database path")
	}
	assertPathExists(t, paths.DatabasePath())
	assertPathExists(t, paths.SettingsDatabasePath())

	response := requestJSON(t, handler, http.MethodGet, "/api/v1/prompt-categories", "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}

	keys := requestJSON(t, handler, http.MethodGet, "/api/v1/settings/api-keys", "")
	defer keys.Body.Close()
	if keys.StatusCode != http.StatusOK {
		t.Fatalf("keys status code = %d, want %d: %s", keys.StatusCode, http.StatusOK, readBody(t, keys.Body))
	}
	body := readBody(t, keys.Body)
	if !strings.Contains(body, `"id":"openrouter"`) ||
		!strings.Contains(body, `"source":"settings"`) ||
		!strings.Contains(body, `"sk-l••••••••ings"`) {
		t.Fatalf("body = %s, want migrated masked openrouter key", body)
	}
}

func TestHealthIsNotReadyWhenRepositoryInitializationFails(t *testing.T) {
	root := t.TempDir()
	blockedParent := filepath.Join(root, "blocked")
	if err := os.WriteFile(blockedParent, []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("creating blocked settings parent: %v", err)
	}
	handler := NewHandlerWithConfig(
		fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
		Config{
			WorkspaceDir:            filepath.Join(root, "workspace"),
			SettingsDBPath:          filepath.Join(blockedParent, "settings.sqlite"),
			DisableGenerationWorker: true,
			DisableWorkspaceWatcher: true,
			agentRunner:             fakeAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	if closer, ok := handler.(interface{ Close() error }); ok {
		t.Cleanup(func() { _ = closer.Close() })
	}

	response := requestJSON(t, handler, http.MethodGet, "/api/v1/health", "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusServiceUnavailable, readBody(t, response.Body))
	}
	body := readBody(t, response.Body)
	if !strings.Contains(body, `"ready":false`) || !strings.Contains(body, `"status":"not_ready"`) {
		t.Fatalf("body = %s, want non-ready status", body)
	}
}

func TestMergeACPProcessEnvAddsVendoredCodexPathWithoutMutatingRelayEnv(t *testing.T) {
	relayEnv := map[string]string{
		"CODEX_HOME":     "/runtime/codex-home",
		"CODEX_PATH":     "/stale/codex",
		"OPENAI_API_KEY": "local-relay-token",
	}
	got := mergeACPProcessEnv(relayEnv, map[string]string{
		"CODEX_PATH": "/resources/agents/codex/codex/bin/codex",
	})

	if got["CODEX_HOME"] != "/runtime/codex-home" || got["CODEX_PATH"] != "/resources/agents/codex/codex/bin/codex" {
		t.Fatalf("merged env = %#v", got)
	}
	if got["DEFAULT_AUTH_REQUEST"] != `{"methodId":"api-key"}` {
		t.Fatalf("DEFAULT_AUTH_REQUEST = %q", got["DEFAULT_AUTH_REQUEST"])
	}
	if relayEnv["CODEX_PATH"] != "/stale/codex" {
		t.Fatalf("relay env mutated = %#v", relayEnv)
	}
}

func TestMergeACPProcessEnvDoesNotForceAPIKeyAuthWithoutKey(t *testing.T) {
	got := mergeACPProcessEnv(nil, map[string]string{"CODEX_PATH": "/resources/codex"})
	if _, ok := got["DEFAULT_AUTH_REQUEST"]; ok {
		t.Fatalf("merged env = %#v, should preserve interactive authentication", got)
	}
}

func TestMergeCodexConfigWithDeveloperInstructionsPreservesExistingFields(t *testing.T) {
	rawConfig := `{
		"model":"gpt-5.6-sol",
		"model_providers":{"custom":{"base_url":"https://gateway.example.com/v1"}},
		"sandbox_workspace_write":{"writable_roots":["/tmp/mediago"]},
		"developer_instructions":"legacy instructions",
		"large_integer":9007199254740993
	}`

	merged, err := mergeCodexConfigWithDeveloperInstructions(rawConfig, "MediaGo fixed instructions")
	if err != nil {
		t.Fatalf("mergeCodexConfigWithDeveloperInstructions returned error: %v", err)
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(merged), &parsed); err != nil {
		t.Fatalf("merged CODEX_CONFIG is invalid JSON: %v\n%s", err, merged)
	}
	if len(parsed) != 5 {
		t.Fatalf("merged CODEX_CONFIG keys = %#v, want every existing field preserved", parsed)
	}
	assertRawJSONString(t, parsed, "model", "gpt-5.6-sol")
	assertRawJSONString(t, parsed, "developer_instructions", "MediaGo fixed instructions")
	if got := string(parsed["large_integer"]); got != "9007199254740993" {
		t.Fatalf("large_integer = %s, want exact integer without float64 precision loss", got)
	}

	var providers map[string]struct {
		BaseURL string `json:"base_url"`
	}
	if err := json.Unmarshal(parsed["model_providers"], &providers); err != nil {
		t.Fatalf("decoding model_providers: %v", err)
	}
	if providers["custom"].BaseURL != "https://gateway.example.com/v1" {
		t.Fatalf("model_providers = %#v, want existing nested provider preserved", providers)
	}

	var sandbox struct {
		WritableRoots []string `json:"writable_roots"`
	}
	if err := json.Unmarshal(parsed["sandbox_workspace_write"], &sandbox); err != nil {
		t.Fatalf("decoding sandbox_workspace_write: %v", err)
	}
	if len(sandbox.WritableRoots) != 1 || sandbox.WritableRoots[0] != "/tmp/mediago" {
		t.Fatalf("sandbox_workspace_write = %#v, want existing roots preserved", sandbox)
	}
}

func TestMergeCodexConfigWithDeveloperInstructionsCreatesConfigFromEmptyInput(t *testing.T) {
	merged, err := mergeCodexConfigWithDeveloperInstructions("", "MediaGo fixed instructions")
	if err != nil {
		t.Fatalf("mergeCodexConfigWithDeveloperInstructions returned error: %v", err)
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(merged), &parsed); err != nil {
		t.Fatalf("merged CODEX_CONFIG is invalid JSON: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("merged CODEX_CONFIG = %#v, want only developer_instructions", parsed)
	}
	assertRawJSONString(t, parsed, "developer_instructions", "MediaGo fixed instructions")
}

func TestMergeCodexConfigWithDeveloperInstructionsRejectsInvalidOrNonObjectJSON(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "malformed", raw: `{"model":`},
		{name: "array", raw: `[]`},
		{name: "null", raw: `null`},
		{name: "string", raw: `"codex"`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := mergeCodexConfigWithDeveloperInstructions(test.raw, "MediaGo fixed instructions"); err == nil {
				t.Fatalf("mergeCodexConfigWithDeveloperInstructions(%s) returned nil error", test.raw)
			}
		})
	}
}

func TestMergeCodexConfigWithDeveloperInstructionsPreservesParentEnvironmentConfig(t *testing.T) {
	t.Setenv("CODEX_CONFIG", `{"model":"gpt-parent","model_reasoning_effort":"high"}`)

	merged, err := mergeCodexConfigWithDeveloperInstructions(
		os.Getenv("CODEX_CONFIG"),
		"MediaGo fixed instructions",
	)
	if err != nil {
		t.Fatalf("mergeCodexConfigWithDeveloperInstructions returned error: %v", err)
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(merged), &parsed); err != nil {
		t.Fatalf("merged parent CODEX_CONFIG is invalid JSON: %v", err)
	}
	assertRawJSONString(t, parsed, "model", "gpt-parent")
	assertRawJSONString(t, parsed, "model_reasoning_effort", "high")
	assertRawJSONString(t, parsed, "developer_instructions", "MediaGo fixed instructions")
}

func TestWithCodexDeveloperInstructionsReadsInheritedConfigAndOverridesItForChild(t *testing.T) {
	t.Setenv("CODEX_CONFIG", `{"model":"gpt-parent","developer_instructions":"parent"}`)
	env, err := withCodexDeveloperInstructions(
		map[string]string{"CODEX_PATH": "/resources/codex"},
		"MediaGo fixed instructions",
	)
	if err != nil {
		t.Fatalf("withCodexDeveloperInstructions returned error: %v", err)
	}
	if env["CODEX_PATH"] != "/resources/codex" {
		t.Fatalf("env = %#v, want existing process environment preserved", env)
	}
	if env["CODEX_CONFIG"] == os.Getenv("CODEX_CONFIG") {
		t.Fatalf("CODEX_CONFIG = %q, want child-specific overlay", env["CODEX_CONFIG"])
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(env["CODEX_CONFIG"]), &parsed); err != nil {
		t.Fatalf("child CODEX_CONFIG is invalid JSON: %v", err)
	}
	assertRawJSONString(t, parsed, "model", "gpt-parent")
	assertRawJSONString(t, parsed, "developer_instructions", "MediaGo fixed instructions")
}

func TestWithCodexDeveloperInstructionsForWindowsUsesSerializedUTF16Size(t *testing.T) {
	// This JSON is larger than the Windows limit in UTF-8 bytes, but comfortably
	// below it after Windows converts the environment value to UTF-16.
	instructions := strings.Repeat("界", 12_000)
	env, err := withCodexDeveloperInstructionsForGOOS(map[string]string{"CODEX_CONFIG": "{}"}, instructions, "windows")
	if err != nil {
		t.Fatalf("withCodexDeveloperInstructionsForGOOS returned error: %v", err)
	}
	if len(env["CODEX_CONFIG"]) <= windowsEnvironmentVariableMaxUTF16CodeUnits {
		t.Fatalf("test fixture is only %d UTF-8 bytes, want more than %d", len(env["CODEX_CONFIG"]), windowsEnvironmentVariableMaxUTF16CodeUnits)
	}
	if got := utf16CodeUnitCount(env["CODEX_CONFIG"]); got >= windowsEnvironmentVariableMaxUTF16CodeUnits {
		t.Fatalf("CODEX_CONFIG uses %d UTF-16 code units, want fewer than %d", got, windowsEnvironmentVariableMaxUTF16CodeUnits)
	}
}

func TestWithCodexDeveloperInstructionsForWindowsRejectsOversizedNativeConfig(t *testing.T) {
	instructions := strings.Repeat("😀", 17_000)
	env, err := withCodexDeveloperInstructionsForGOOS(map[string]string{"CODEX_CONFIG": "{}"}, instructions, "windows")
	if err == nil {
		t.Fatal("withCodexDeveloperInstructionsForGOOS returned nil error for an oversized Windows environment value")
	}
	if env != nil {
		t.Fatalf("env = %#v, want no process config after native instruction injection failed", env)
	}
	for _, want := range []string{"CODEX_CONFIG", "UTF-16", "Windows", "prompt.instruction_delivery", "inline"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error = %q, want actionable detail %q", err, want)
		}
	}
}

func TestWithCodexDeveloperInstructionsDoesNotApplyWindowsLimitToOtherTargets(t *testing.T) {
	instructions := strings.Repeat("😀", 17_000)
	env, err := withCodexDeveloperInstructionsForGOOS(map[string]string{"CODEX_CONFIG": "{}"}, instructions, "darwin")
	if err != nil {
		t.Fatalf("non-Windows target rejected CODEX_CONFIG: %v", err)
	}
	if got := utf16CodeUnitCount(env["CODEX_CONFIG"]); got <= windowsEnvironmentVariableMaxUTF16CodeUnits {
		t.Fatalf("test CODEX_CONFIG uses %d UTF-16 code units, want more than Windows limit %d", got, windowsEnvironmentVariableMaxUTF16CodeUnits)
	}
}

func TestUTF16CodeUnitCountCountsNonBMPCharactersAsTwoUnits(t *testing.T) {
	if got := utf16CodeUnitCount("A界😀"); got != 4 {
		t.Fatalf("utf16CodeUnitCount = %d, want 4", got)
	}
}

func TestUseNativeACPInstructionsSupportsInlineRollback(t *testing.T) {
	if !useNativeACPInstructions("") || !useNativeACPInstructions("native") {
		t.Fatal("empty and native delivery should use native instructions")
	}
	if useNativeACPInstructions(" INLINE ") {
		t.Fatal("inline delivery should keep the compatibility prompt path")
	}
}

func TestNewHandlerWiresFixedInstructionsIntoCodexProcessConfig(t *testing.T) {
	t.Setenv("CODEX_CONFIG", `{"model":"gpt-parent","developer_instructions":"parent"}`)
	workspaceDir := filepath.Join(t.TempDir(), "workspace")
	runner := &processConfigCapturingRunner{}
	handler := NewHandlerWithConfig(
		fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
		Config{
			WorkspaceDir:            workspaceDir,
			DisableGenerationWorker: true,
			DisableWorkspaceWatcher: true,
			agentRunner:             runner,
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	closeTestHandler(t, handler)
	if runner.processConfigProvider == nil {
		t.Fatal("agent runner did not receive the ACP process config provider")
	}

	processConfig, err := runner.processConfigProvider.PrepareACPProcessConfig(context.Background(), serviceacp.ProcessConfigRequest{
		AgentID:           "codex",
		WorkspaceDir:      workspaceDir,
		PreferredModel:    "gpt-parent",
		FixedInstructions: "MediaGo fixed instructions",
	})
	if err != nil {
		t.Fatalf("preparing Codex process config: %v", err)
	}
	if !processConfig.NativeInstructionsInjected {
		t.Fatal("Codex process config should acknowledge native instruction injection")
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(processConfig.Env["CODEX_CONFIG"]), &parsed); err != nil {
		t.Fatalf("child CODEX_CONFIG is invalid JSON: %v", err)
	}
	assertRawJSONString(t, parsed, "model", "gpt-parent")
	assertRawJSONString(t, parsed, "developer_instructions", "MediaGo fixed instructions")
}

type processConfigCapturingRunner struct {
	fakeAgentRunner
	processConfigProvider serviceacp.ProcessConfigProvider
}

func (runner *processConfigCapturingRunner) SetProcessConfigProvider(provider serviceacp.ProcessConfigProvider) {
	runner.processConfigProvider = provider
}

func assertRawJSONString(t *testing.T, values map[string]json.RawMessage, key string, want string) {
	t.Helper()
	raw, ok := values[key]
	if !ok {
		t.Fatalf("JSON field %q is missing from %#v", key, values)
	}
	var got string
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decoding JSON field %q: %v", key, err)
	}
	if got != want {
		t.Fatalf("JSON field %q = %q, want %q", key, got, want)
	}
}
