package mcp

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// DocumentHTTPURLConfig describes a document MCP streamable HTTP URL.
type DocumentHTTPURLConfig struct {
	BridgeURL        string
	ProjectID        string
	SessionID        string
	RunID            string
	AgentTag         string
	ActiveDocumentID string
	SelectionText    string
}

// DocumentHTTPURL builds the run-scoped document MCP streamable HTTP URL.
func DocumentHTTPURL(config DocumentHTTPURLConfig) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(config.BridgeURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	parsed.Path = DocumentHTTPPath
	parsed.RawPath = ""
	values := parsed.Query()
	values.Set("projectId", config.ProjectID)
	if config.SessionID != "" {
		values.Set("sessionId", config.SessionID)
	}
	if config.RunID != "" {
		values.Set("runId", config.RunID)
	}
	if config.AgentTag != "" {
		values.Set("agentTag", config.AgentTag)
	}
	if config.ActiveDocumentID != "" {
		values.Set("activeDocumentId", config.ActiveDocumentID)
	}
	if config.SelectionText != "" {
		values.Set("selectionText", config.SelectionText)
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), true
}

// GenerationHTTPURLConfig describes a generation MCP streamable HTTP URL.
type GenerationHTTPURLConfig struct {
	BridgeURL string
	ProjectID string
	SessionID string
	RunID     string
	AgentTag  string
}

// GenerationHTTPURL builds the project- and run-scoped generation MCP
// streamable HTTP URL. SessionID/RunID bind image and video submissions to the
// generation_plan explicitly confirmed in that agent run; AgentTag is used for
// diagnostics.
func GenerationHTTPURL(config GenerationHTTPURLConfig) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(config.BridgeURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	parsed.Path = GenerationHTTPPath
	parsed.RawPath = ""
	values := parsed.Query()
	values.Set("projectId", config.ProjectID)
	if config.SessionID != "" {
		values.Set("sessionId", config.SessionID)
	}
	if config.RunID != "" {
		values.Set("runId", config.RunID)
	}
	if config.AgentTag != "" {
		values.Set("agentTag", config.AgentTag)
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), true
}

// NewStatelessHTTPHandler creates the shared MCP streamable HTTP handler.
func NewStatelessHTTPHandler(factory func(*http.Request) *mcpsdk.Server, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return mcpsdk.NewStreamableHTTPHandler(factory, &mcpsdk.StreamableHTTPOptions{
		Stateless:                  true,
		SessionTimeout:             HTTPServerSessionTimeout,
		DisableLocalhostProtection: true,
		Logger:                     logger,
	})
}
