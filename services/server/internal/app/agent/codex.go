package agent

import (
	"log/slog"
	"strings"

	serviceruntime "github.com/mediago-dev/mediago-drama/services/server/internal/service/codex"
)

// SetRuntimeLogger directs Runtime runner and protocol logs to the given logger.
func SetRuntimeLogger(logger *slog.Logger) {
	serviceruntime.SetLogger(logger)
}

// MediaGoDramaMCPServerName is the Runtime MCP server name for MediaGo Drama tools.
const MediaGoDramaMCPServerName = serviceruntime.MediaGoDramaMCPServerName

// DocumentMCPServerResolution describes how Runtime should attach document MCP tools.
type DocumentMCPServerResolution = serviceruntime.DocumentMCPServerResolution

// NewRuntimeRunner creates an Runtime-backed agent runner.
func NewRuntimeRunner(command string, workspaceDir string, buildPrompt func(RunRequest) string, commandFn func() string) Runner {
	return NewRuntimeRunnerWithDocumentMCPConfigPath(command, workspaceDir, "", buildPrompt, commandFn)
}

// NewRuntimeRunnerWithDocumentMCPConfigPath creates an Runtime runner with stdio MCP config.
func NewRuntimeRunnerWithDocumentMCPConfigPath(
	command string,
	workspaceDir string,
	documentMCPConfigPath string,
	buildPrompt func(RunRequest) string,
	commandFn func() string,
) Runner {
	return NewRuntimeRunnerWithDocumentMCPConfigPathAndArgv(
		command,
		workspaceDir,
		documentMCPConfigPath,
		buildPrompt,
		commandFn,
		nil,
	)
}

// NewRuntimeRunnerWithDocumentMCPConfigPathAndArgv creates an Runtime runner with an argv provider.
func NewRuntimeRunnerWithDocumentMCPConfigPathAndArgv(
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
	return serviceruntime.NewRuntimeAgentRunnerWithDocumentMCPConfigPathAndArgv(
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
	return serviceruntime.MediaGoDramaMCPToolPrefix()
}

// MediaGoDramaMCPToolName returns a fully-qualified MediaGo Drama MCP tool name.
func MediaGoDramaMCPToolName(toolName string) string {
	return serviceruntime.MediaGoDramaMCPToolName(toolName)
}

// DiagnosticProjectID returns a compact, log-safe project identifier.
func DiagnosticProjectID(projectID string) string {
	return serviceruntime.DiagnosticProjectID(projectID)
}
