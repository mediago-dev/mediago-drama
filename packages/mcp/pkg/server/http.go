package server

import (
	"log/slog"
	"net/http"

	"github.com/mediago-dev/mediago-drama/packages/mcp/internal/httpx"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	// DocumentHTTPPath is the streamable HTTP route for run-scoped document tools.
	DocumentHTTPPath = mediamcp.DocumentHTTPPath
	// GenerationHTTPPath is the streamable HTTP route for generation tools.
	GenerationHTTPPath = mediamcp.GenerationHTTPPath
	// BridgeURLHeader forwards the bridge base URL to HTTP-hosted MCP tools.
	BridgeURLHeader = mediamcp.BridgeURLHeader
	// BridgeTokenHeader forwards the bridge bearer token to HTTP-hosted MCP tools.
	BridgeTokenHeader = mediamcp.BridgeTokenHeader
)

// NewStatelessHTTPHandler creates the shared MCP streamable HTTP handler.
func NewStatelessHTTPHandler(factory func(*http.Request) *mcpsdk.Server, logger *slog.Logger) http.Handler {
	return httpx.NewStatelessHandler(factory, logger)
}
