package acp

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestDocumentMCPServersValidateProjectID(t *testing.T) {
	root := t.TempDir()
	if servers := DocumentMCPServers(root, "../project"); len(servers) != 0 {
		t.Fatalf("servers = %#v, want none for invalid project id", servers)
	}
	fakeExecutable := filepath.Join(t.TempDir(), "mediago-document-mcp")
	if err := os.WriteFile(fakeExecutable, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("writing fake executable: %v", err)
	}
	withProcessExecutable(t, filepath.Join(filepath.Dir(fakeExecutable), "mediago-server"))

	servers := DocumentMCPServers(root, "project-safe_1")
	if len(servers) != 1 || servers[0].Stdio == nil {
		t.Fatalf("servers = %#v, want one stdio server", servers)
	}
	if servers[0].Stdio.Name != MediaGoDramaMCPServerName {
		t.Fatalf("server name = %q, want %q", servers[0].Stdio.Name, MediaGoDramaMCPServerName)
	}
	args := strings.Join(servers[0].Stdio.Args, " ")
	if !strings.Contains(args, "--project project-safe_1") {
		t.Fatalf("args = %q, want project id argument", args)
	}
	if strings.Contains(args, "mcp document") || strings.Contains(args, "--workspace-dir") {
		t.Fatalf("args = %q, should target standalone document MCP binary", args)
	}

	configuredServers := DocumentMCPServersForRun(root, AgentRunRequest{
		ProjectID:             "project-safe_1",
		DocumentMCPConfigPath: "/tmp/mediago-server.yaml",
	})
	configuredArgs := strings.Join(configuredServers[0].Stdio.Args, " ")
	if !strings.Contains(configuredArgs, "--config /tmp/mediago-server.yaml") ||
		!strings.Contains(configuredArgs, "--project project-safe_1") {
		t.Fatalf("args = %q, want config and project arguments", configuredArgs)
	}

	agentServers := DocumentMCPServersForRun(root, AgentRunRequest{
		ProjectID: "project-safe_1",
	})
	agentEnv := map[string]string{}
	for _, item := range agentServers[0].Stdio.Env {
		agentEnv[item.Name] = item.Value
	}
	if agentEnv["MEDIAGO_DRAMA_AGENT_TAG"] != "MediaGo Drama Agent" ||
		!strings.Contains(agentEnv["MEDIAGO_DRAMA_ROLE_PERSONA"], "本地工作区 Agent") {
		t.Fatalf("agent env = %#v, want fixed agent guideline env", agentEnv)
	}
	if _, ok := agentEnv["MEDIAGO_DRAMA_AGENT_ROLE_ID"]; ok {
		t.Fatalf("agent env = %#v, should not include role id", agentEnv)
	}
	if _, ok := agentEnv["MEDIAGO_DRAMA_ROLE_NAME"]; ok {
		t.Fatalf("agent env = %#v, should not include role name", agentEnv)
	}

	httpServers := DocumentMCPServersForRun(root, AgentRunRequest{
		ProjectID:   "project-safe_1",
		SessionID:   "session-1",
		RunID:       "run-1",
		AgentTag:    "MediaGo Drama Agent",
		BridgeURL:   "http://127.0.0.1:8080/api/v1/internal/mcp",
		BridgeToken: "bridge-token",
	})
	if len(httpServers) != 1 || httpServers[0].Http == nil {
		t.Fatalf("servers = %#v, want one http server when bridge is available", httpServers)
	}
	if httpServers[0].Http.Name != MediaGoDramaMCPServerName {
		t.Fatalf("http server name = %q, want %q", httpServers[0].Http.Name, MediaGoDramaMCPServerName)
	}
	if !strings.Contains(httpServers[0].Http.Url, mediamcp.DocumentHTTPPath) ||
		!strings.Contains(httpServers[0].Http.Url, "projectId=project-safe_1") ||
		!strings.Contains(httpServers[0].Http.Url, "agentTag=MediaGo+Drama+Agent") {
		t.Fatalf("http url = %q, want document MCP route with run context", httpServers[0].Http.Url)
	}
	if strings.Contains(httpServers[0].Http.Url, "roleId=") {
		t.Fatalf("http url = %q, should not include roleId", httpServers[0].Http.Url)
	}
	if strings.Contains(httpServers[0].Http.Url, "bridge-token") {
		t.Fatalf("http url = %q, should not leak bridge token", httpServers[0].Http.Url)
	}
	headers := map[string]string{}
	for _, item := range httpServers[0].Http.Headers {
		headers[item.Name] = item.Value
	}
	if headers["Authorization"] != "Bearer bridge-token" ||
		headers[mediamcp.BridgeURLHeader] == "" ||
		headers[mediamcp.BridgeTokenHeader] != "bridge-token" {
		t.Fatalf("http headers = %#v, want auth and bridge headers", headers)
	}
}

func TestResolveDocumentMCPServersReportsDisabledReason(t *testing.T) {
	root := t.TempDir()

	missing := ResolveDocumentMCPServersForRun(root, AgentRunRequest{})
	if missing.DisabledReason != "missing_project_id" || len(missing.Servers) != 0 {
		t.Fatalf("missing resolution = %#v, want missing_project_id without servers", missing)
	}
	if message := DocumentMCPDisabledActivityMessage(missing); !strings.Contains(message, "缺少 projectId") {
		t.Fatalf("message = %q, want missing project id detail", message)
	}

	invalid := ResolveDocumentMCPServersForRun(root, AgentRunRequest{ProjectID: "project.with.dot"})
	if invalid.DisabledReason != "invalid_project_id" || len(invalid.Servers) != 0 {
		t.Fatalf("invalid resolution = %#v, want invalid_project_id without servers", invalid)
	}
	if message := DocumentMCPDisabledActivityMessage(invalid); !strings.Contains(message, "project.with.dot") {
		t.Fatalf("message = %q, want invalid project id value", message)
	}

	withProcessExecutable(t, filepath.Join(t.TempDir(), "mediago-server"))
	withWorkingDir(t, t.TempDir())
	unavailable := ResolveDocumentMCPServersForRun(root, AgentRunRequest{ProjectID: "project-safe_1"})
	if unavailable.DisabledReason != "executable_unavailable" || len(unavailable.Servers) != 0 {
		t.Fatalf("unavailable resolution = %#v, want executable_unavailable without servers", unavailable)
	}
}

func TestDocumentMCPExecutableFallsBackToWorkspaceBinForGoRun(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("creating bin dir: %v", err)
	}
	fakeDocumentMCP := filepath.Join(binDir, "mediago-document-mcp")
	if err := os.WriteFile(fakeDocumentMCP, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("writing fake document MCP: %v", err)
	}
	withProcessExecutable(t, filepath.Join(t.TempDir(), "go-build1234", "mediago-server"))
	withWorkingDir(t, filepath.Join(root, "packages", "server"))

	executable, err := documentMCPExecutable()
	if err != nil {
		t.Fatalf("documentMCPExecutable() error = %v", err)
	}
	if !sameFile(t, executable, fakeDocumentMCP) {
		t.Fatalf("executable = %q, want %q", executable, fakeDocumentMCP)
	}
}

func withProcessExecutable(t *testing.T, path string) {
	t.Helper()
	previous := processExecutablePath
	processExecutablePath = func() (string, error) {
		return path, nil
	}
	t.Cleanup(func() {
		processExecutablePath = previous
	})
}

func sameFile(t *testing.T, left string, right string) bool {
	t.Helper()
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return os.SameFile(leftInfo, rightInfo)
}

func withWorkingDir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("creating working dir: %v", err)
	}
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("reading working dir: %v", err)
	}
	if err := os.Chdir(path); err != nil {
		t.Fatalf("changing working dir: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatalf("restoring working dir: %v", err)
		}
	})
}
