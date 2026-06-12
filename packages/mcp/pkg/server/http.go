package server

import (
	"log/slog"
	"net/http"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/torchstellar-team/mediago-drama/packages/mcp/internal/httpx"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

const (
	// DocumentHTTPPath is the streamable HTTP route for run-scoped document tools.
	DocumentHTTPPath = mediamcp.DocumentHTTPPath
	// BridgeURLHeader forwards the bridge base URL to HTTP-hosted MCP tools.
	BridgeURLHeader = mediamcp.BridgeURLHeader
	// BridgeTokenHeader forwards the bridge bearer token to HTTP-hosted MCP tools.
	BridgeTokenHeader = mediamcp.BridgeTokenHeader
)

// NewStatelessHTTPHandler creates the shared MCP streamable HTTP handler.
func NewStatelessHTTPHandler(factory func(*http.Request) *mcpsdk.Server, logger *slog.Logger) http.Handler {
	return httpx.NewStatelessHandler(factory, logger)
}
