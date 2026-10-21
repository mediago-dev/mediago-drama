package codex

import (
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"strings"
)

// MediaGoDramaMCPServerName is the business document tool namespace.
const MediaGoDramaMCPServerName = mediamcp.ServerName

// DocumentMCPServerResolution contains native Codex MCP configuration.
type DocumentMCPServerResolution struct {
	Servers                                                               map[string]any
	ProjectID, Transport, URL, Executable, DisabledReason, DisabledDetail string
}

// ResolveDocumentMCPServersForRun binds business tools to this exact run.
func ResolveDocumentMCPServersForRun(_ string, r AgentRunRequest) DocumentMCPServerResolution {
	result := DocumentMCPServerResolution{Servers: map[string]any{}, ProjectID: r.ProjectID}
	if !domain.ValidProjectID.MatchString(r.ProjectID) || r.BridgeToken == "" {
		result.DisabledReason = "missing_project_context"
		return result
	}
	documentID := ""
	if r.Document != nil {
		documentID = r.Document.ID
	}
	url, ok := mediamcp.DocumentHTTPURL(mediamcp.DocumentHTTPURLConfig{BridgeURL: r.BridgeURL, ProjectID: r.ProjectID, SessionID: r.SessionID, RunID: r.RunID, AgentTag: FirstNonEmpty(r.AgentTag, "codex"), ActiveDocumentID: documentID, SelectionText: r.SelectionText})
	if !ok {
		return result
	}
	headers := map[string]string{"Authorization": "Bearer " + r.BridgeToken, mediamcp.BridgeURLHeader: r.BridgeURL, mediamcp.BridgeTokenHeader: r.BridgeToken}
	result.Servers[mediamcp.ServerName] = map[string]any{"url": url, "http_headers": headers, "required": true}
	if generation, ok := mediamcp.GenerationHTTPURL(mediamcp.GenerationHTTPURLConfig{BridgeURL: r.BridgeURL, ProjectID: r.ProjectID, SessionID: r.SessionID, RunID: r.RunID, AgentTag: FirstNonEmpty(r.AgentTag, "codex")}); ok {
		result.Servers[mediamcp.GenerationServerName] = map[string]any{"url": generation, "http_headers": headers}
	}
	result.Transport = "http"
	result.URL = url
	return result
}

// MediaGoDramaMCPToolPrefix returns the document MCP tool namespace.
func MediaGoDramaMCPToolPrefix() string { return mediamcp.ToolPrefix() }

// MediaGoDramaMCPToolName returns a fully qualified document MCP tool name.
func MediaGoDramaMCPToolName(name string) string { return mediamcp.ToolName(name) }

// DiagnosticProjectID returns a safe project identifier for diagnostics.
func DiagnosticProjectID(id string) string { return domain.DiagnosticProjectID(strings.TrimSpace(id)) }
