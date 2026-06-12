package server

import (
	"net/http"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// Config controls a document or external MCP server instance.
type Config struct {
	WorkspaceDir string
	ProjectID    string
	Transport    string
	Version      string
	Document     mediamcp.DocumentConfig
}

// DocumentHTTPConfigOptions controls document MCP HTTP config parsing.
type DocumentHTTPConfigOptions struct {
	DefaultBridgeURL   string
	DefaultBridgeToken string
}

// DocumentConfigFromHTTPRequest extracts transport-level document MCP config
// from an HTTP request. Host applications can enrich agent names and event
// publishers after parsing.
func DocumentConfigFromHTTPRequest(request *http.Request, options DocumentHTTPConfigOptions) mediamcp.DocumentConfig {
	query := request.URL.Query()
	config := mediamcp.DocumentConfig{
		SessionID:        strings.TrimSpace(query.Get("sessionId")),
		RunID:            strings.TrimSpace(query.Get("runId")),
		BridgeURL:        firstNonEmpty(request.Header.Get(BridgeURLHeader), options.DefaultBridgeURL),
		BridgeToken:      firstNonEmpty(request.Header.Get(BridgeTokenHeader), options.DefaultBridgeToken),
		AgentTag:         strings.TrimSpace(query.Get("agentTag")),
		ActiveDocumentID: strings.TrimSpace(query.Get("activeDocumentId")),
		SelectionText:    strings.TrimSpace(query.Get("selectionText")),
	}
	return config
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
