package acp

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

const MediaGoDramaMCPServerName = mediamcp.ServerName

// MediaGoDramaGenerationMCPServerName is the ACP server name for generation tools.
const MediaGoDramaGenerationMCPServerName = mediamcp.GenerationServerName

// DocumentMCPServerResolution describes how an ACP run should attach MediaGo Drama MCP tools.
type DocumentMCPServerResolution struct {
	Servers        []acp.McpServer
	ProjectID      string
	Transport      string
	URL            string
	Executable     string
	Args           []string
	DisabledReason string
	DisabledDetail string
	// Generation* fields describe the additive generation MCP mount, if any. The
	// generation server is best-effort: when it cannot mount, the document server
	// still resolves and these fields stay empty.
	GenerationTransport  string
	GenerationURL        string
	GenerationExecutable string
}

// DocumentMCPServers returns the document MCP servers for one project.
func DocumentMCPServers(workspaceDir string, projectID string) []acp.McpServer {
	return DocumentMCPServersForRun(workspaceDir, AgentRunRequest{ProjectID: projectID})
}

// DocumentMCPServersForRun returns the document MCP servers for an ACP run.
func DocumentMCPServersForRun(workspaceDir string, request AgentRunRequest) []acp.McpServer {
	return ResolveDocumentMCPServersForRun(workspaceDir, request).Servers
}

// ResolveDocumentMCPServersForRun resolves document MCP transport and launch configuration.
func ResolveDocumentMCPServersForRun(workspaceDir string, request AgentRunRequest) DocumentMCPServerResolution {
	projectID := strings.TrimSpace(request.ProjectID)
	resolution := DocumentMCPServerResolution{ProjectID: projectID}
	if projectID == "" {
		acpLog().Warn(
			"document MCP server disabled; invalid project id",
			"project_id", projectID,
			"reason", "missing_project_id",
		)
		resolution.DisabledReason = "missing_project_id"
		return resolution
	}
	if !domain.ValidProjectID.MatchString(projectID) {
		acpLog().Warn(
			"document MCP server disabled; invalid project id",
			"project_id", DiagnosticProjectID(projectID),
			"reason", "invalid_project_id",
			"pattern", domain.ValidProjectID.String(),
		)
		resolution.DisabledReason = "invalid_project_id"
		resolution.DisabledDetail = domain.ValidProjectID.String()
		return resolution
	}
	agentTag := FirstNonEmpty(request.AgentTag, agent.DefaultAgentName)
	if request.BridgeToken != "" {
		if httpURL, ok := documentMCPHTTPURL(request.BridgeURL, projectID, request, agentTag); ok {
			bridgeHeaders := []acp.HttpHeader{
				{Name: "Authorization", Value: "Bearer " + request.BridgeToken},
				{Name: mediamcp.BridgeURLHeader, Value: request.BridgeURL},
				{Name: mediamcp.BridgeTokenHeader, Value: request.BridgeToken},
			}
			resolution.Transport = "http"
			resolution.URL = httpURL
			resolution.Servers = []acp.McpServer{
				{
					Http: &acp.McpServerHttpInline{
						Name:    MediaGoDramaMCPServerName,
						Url:     httpURL,
						Headers: bridgeHeaders,
					},
				},
			}
			if generationURL, generationOK := generationMCPHTTPURL(request.BridgeURL, projectID, request, agentTag); generationOK {
				resolution.GenerationTransport = "http"
				resolution.GenerationURL = generationURL
				resolution.Servers = append(resolution.Servers, acp.McpServer{
					Http: &acp.McpServerHttpInline{
						Name:    MediaGoDramaGenerationMCPServerName,
						Url:     generationURL,
						Headers: bridgeHeaders,
					},
				})
			}
			acpLog().Debug(
				"document MCP server configured",
				"project_id", projectID,
				"server_name", MediaGoDramaMCPServerName,
				"transport", resolution.Transport,
				"url", httpURL,
				"generation_transport", resolution.GenerationTransport,
				"generation_url", resolution.GenerationURL,
				"has_bridge", request.BridgeURL != "" && request.BridgeToken != "",
			)
			return resolution
		}
		acpLog().Warn(
			"document MCP HTTP server unavailable; falling back to stdio",
			"project_id", DiagnosticProjectID(projectID),
			"bridge_url", request.BridgeURL,
		)
	}
	executable, err := documentMCPExecutable()
	if err != nil || strings.TrimSpace(executable) == "" {
		acpLog().Warn("document MCP server disabled; executable path unavailable", "error", err)
		resolution.DisabledReason = "executable_unavailable"
		if err != nil {
			resolution.DisabledDetail = err.Error()
		}
		return resolution
	}
	resolution.Transport = "stdio"
	resolution.Executable = executable
	env := []acp.EnvVariable{}
	for _, item := range mediamcp.DocumentStdioEnv(mediamcp.DocumentLaunchConfig{
		SessionID:        request.SessionID,
		RunID:            request.RunID,
		RolePersona:      agent.DefaultAgentPersona,
		AgentTag:         agentTag,
		BridgeURL:        request.BridgeURL,
		BridgeToken:      request.BridgeToken,
		ActiveDocumentID: activeAgentDocumentID(request),
		SelectionText:    request.SelectionText,
	}) {
		env = append(env, acp.EnvVariable{Name: item.Name, Value: item.Value})
	}
	args := []string{}
	if configPath := strings.TrimSpace(request.DocumentMCPConfigPath); configPath != "" {
		args = append(args, "--config", configPath)
	}
	args = append(args, "--project", projectID)
	resolution.Args = args
	resolution.Servers = []acp.McpServer{
		{
			Stdio: &acp.McpServerStdio{
				Name:    MediaGoDramaMCPServerName,
				Command: executable,
				Args:    args,
				Env:     env,
			},
		},
	}
	if generationExecutable, generationErr := generationMCPExecutable(); generationErr == nil && strings.TrimSpace(generationExecutable) != "" {
		generationArgs := generationMCPStdioArgs(request, projectID)
		resolution.GenerationTransport = "stdio"
		resolution.GenerationExecutable = generationExecutable
		resolution.Servers = append(resolution.Servers, acp.McpServer{
			Stdio: &acp.McpServerStdio{
				Name:    MediaGoDramaGenerationMCPServerName,
				Command: generationExecutable,
				Args:    generationArgs,
				Env:     env,
			},
		})
	} else if generationErr != nil {
		acpLog().Warn(
			"generation MCP server unavailable; document tools still mounted",
			"project_id", DiagnosticProjectID(projectID),
			"error", generationErr,
		)
	}
	acpLog().Debug(
		"document MCP server configured",
		"project_id", projectID,
		"server_name", MediaGoDramaMCPServerName,
		"transport", resolution.Transport,
		"command", executable,
		"args", strings.Join(args, " "),
		"generation_transport", resolution.GenerationTransport,
		"generation_command", resolution.GenerationExecutable,
		"has_bridge", request.BridgeURL != "" && request.BridgeToken != "",
	)
	return resolution
}

var processExecutablePath = os.Executable

func documentMCPExecutable() (string, error) {
	return mcpExecutable("mediago-document-mcp")
}

// mcpExecutable resolves the path to a sibling MCP binary (document or
// generation) by probing the running executable's directory and workspace
// ancestor bin/ directories.
func mcpExecutable(binaryName string) (string, error) {
	executable, err := processExecutablePath()
	if err != nil {
		return "", err
	}
	executable = strings.TrimSpace(executable)
	if executable == "" {
		return "", nil
	}
	candidates := []string{}
	if filepath.Base(executable) == binaryName {
		candidates = append(candidates, executable)
	} else {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), binaryName))
	}
	if cwd, cwdErr := os.Getwd(); cwdErr == nil {
		for _, dir := range ancestorDirs(cwd, 8) {
			candidates = append(candidates, filepath.Join(dir, "bin", binaryName))
		}
	}

	var firstErr error
	for _, candidate := range uniqueStrings(candidates) {
		if candidate == "" {
			continue
		}
		if info, statErr := os.Stat(candidate); statErr != nil {
			if firstErr == nil {
				firstErr = statErr
			}
			continue
		} else if info.IsDir() {
			if firstErr == nil {
				firstErr = fmt.Errorf("%s is a directory", candidate)
			}
			continue
		}
		return candidate, nil
	}
	return "", firstErr
}

func ancestorDirs(path string, limit int) []string {
	path = filepath.Clean(path)
	result := []string{}
	for i := 0; i < limit; i++ {
		if path == "" || path == "." {
			break
		}
		result = append(result, path)
		parent := filepath.Dir(path)
		if parent == path {
			break
		}
		path = parent
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func documentMCPHTTPURL(bridgeURL string, projectID string, request AgentRunRequest, agentTag string) (string, bool) {
	return mediamcp.DocumentHTTPURL(mediamcp.DocumentHTTPURLConfig{
		BridgeURL:        strings.TrimSpace(bridgeURL),
		ProjectID:        projectID,
		SessionID:        request.SessionID,
		RunID:            request.RunID,
		AgentTag:         agentTag,
		ActiveDocumentID: activeAgentDocumentID(request),
		SelectionText:    request.SelectionText,
	})
}

func generationMCPHTTPURL(bridgeURL string, projectID string, request AgentRunRequest, agentTag string) (string, bool) {
	return mediamcp.GenerationHTTPURL(mediamcp.GenerationHTTPURLConfig{
		BridgeURL: strings.TrimSpace(bridgeURL),
		ProjectID: projectID,
		SessionID: request.SessionID,
		RunID:     request.RunID,
		AgentTag:  agentTag,
	})
}

// generationMCPStdioArgs builds the CLI args for the generation MCP stdio binary.
// The binary scopes by --project and loads server config the same way the
// document MCP binary does, so it reuses the document MCP config path.
func generationMCPStdioArgs(request AgentRunRequest, projectID string) []string {
	args := []string{}
	if configPath := strings.TrimSpace(request.DocumentMCPConfigPath); configPath != "" {
		args = append(args, "--config", configPath)
	}
	return append(args, "--project", projectID)
}

func generationMCPExecutable() (string, error) {
	return mcpExecutable("mediago-generation-mcp")
}

// DocumentMCPDisabledActivityMessage returns the activity text for a disabled MCP mount.
func DocumentMCPDisabledActivityMessage(resolution DocumentMCPServerResolution) string {
	switch resolution.DisabledReason {
	case "missing_project_id":
		return MediaGoDramaMCPServerName + " MCP 工具未挂载：缺少 projectId，Agent 只能使用 Codex 内置工具。"
	case "invalid_project_id":
		return fmt.Sprintf(
			"%s MCP 工具未挂载：projectId 不合法（%s），只允许 1-64 位字母、数字、下划线或连字符。",
			MediaGoDramaMCPServerName,
			DiagnosticProjectID(resolution.ProjectID),
		)
	case "executable_unavailable":
		return MediaGoDramaMCPServerName + " MCP 工具未挂载：无法定位 document MCP 可执行文件，Agent 只能使用 Codex 内置工具。"
	default:
		return MediaGoDramaMCPServerName + " MCP 工具未挂载：Agent 只能使用 Codex 内置工具。"
	}
}

// MediaGoDramaMCPToolPrefix returns the MediaGo Drama MCP tool prefix.
func MediaGoDramaMCPToolPrefix() string {
	return mediamcp.ToolPrefix()
}

// MediaGoDramaMCPToolName returns the namespaced MediaGo Drama MCP tool name.
func MediaGoDramaMCPToolName(toolName string) string {
	return mediamcp.ToolName(toolName)
}

// DiagnosticProjectID formats a project ID for logs and messages.
func DiagnosticProjectID(projectID string) string {
	return domain.DiagnosticProjectID(projectID)
}
