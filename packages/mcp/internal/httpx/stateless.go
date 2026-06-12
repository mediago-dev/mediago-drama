package httpx

import (
	"log/slog"
	"net/http"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// NewStatelessHandler wraps the shared stateless streamable HTTP handler.
func NewStatelessHandler(factory func(*http.Request) *mcpsdk.Server, logger *slog.Logger) http.Handler {
	return mediamcp.NewStatelessHTTPHandler(factory, logger)
}
