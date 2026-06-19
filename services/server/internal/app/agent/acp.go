package agent

import (
	"log/slog"
	"strings"

	serviceacp "github.com/mediago-dev/mediago-drama/services/server/internal/service/acp"
)

// SetACPLogger directs ACP runner and protocol logs to the given logger.
func SetACPLogger(logger *slog.Logger) {
	serviceacp.SetLogger(logger)
}

// MediaGoDramaMCPServerName is the ACP MCP server name for MediaGo Drama tools.
const MediaGoDramaMCPServerName = serviceacp.MediaGoDramaMCPServerName

// DocumentMCPServerResolution describes how ACP should attach document MCP tools.
type DocumentMCPServerResolution = serviceacp.DocumentMCPServerResolution

// NewACPRunner creates an ACP-backed agent runner.
func NewACPRunner(command string, workspaceDir string, buildPrompt func(RunRequest) string, commandFn func() string) Runner {
	return NewACPRunnerWithDocumentMCPConfigPath(command, workspaceDir, "", buildPrompt, commandFn)
}

// NewACPRunnerWithDocumentMCPConfigPath creates an ACP runner with stdio MCP config.
func NewACPRunnerWithDocumentMCPConfigPath(
	command string,
	workspaceDir string,
	documentMCPConfigPath string,
	buildPrompt func(RunRequest) string,
	commandFn func() string,
) Runner {
	return NewACPRunnerWithDocumentMCPConfigPathAndArgv(
		command,
		workspaceDir,
		documentMCPConfigPath,
		buildPrompt,
		commandFn,
		nil,
	)
}

// NewACPRunnerWithDocumentMCPConfigPathAndArgv creates an ACP runner with an argv provider.
func NewACPRunnerWithDocumentMCPConfigPathAndArgv(
	command string,
	workspaceDir string,
	documentMCPConfigPath string,
	buildPrompt func(RunRequest) string,
	commandFn func() string,
	argvFn func() []string,
) Runner {
	command = strings.TrimSpace(command)
	workspaceDir = strings.TrimSpace(workspaceDir)
	documentMCPConfigPath = strings.TrimSpace(documentMCPConfigPath)
	return serviceacp.NewACPAgentRunnerWithDocumentMCPConfigPathAndArgv(
		command,
		workspaceDir,
		documentMCPConfigPath,
		buildPrompt,
		commandFn,
		argvFn,
	)
}

// MediaGoDramaMCPToolPrefix returns the prefixed MCP tool namespace.
func MediaGoDramaMCPToolPrefix() string {
	return serviceacp.MediaGoDramaMCPToolPrefix()
}

// MediaGoDramaMCPToolName returns a fully-qualified MediaGo Drama MCP tool name.
func MediaGoDramaMCPToolName(toolName string) string {
	return serviceacp.MediaGoDramaMCPToolName(toolName)
}

// DiagnosticProjectID returns a compact, log-safe project identifier.
func DiagnosticProjectID(projectID string) string {
	return serviceacp.DiagnosticProjectID(projectID)
}
