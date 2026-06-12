package handlers

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
)

// MCPServerFactory creates a stateless MCP server for one HTTP request.
type MCPServerFactory func(request *http.Request) *mcpsdk.Server

// DocumentMCPServerFactory creates a project-scoped document MCP server.
type DocumentMCPServerFactory func(request *http.Request, projectID string) *mcpsdk.Server

// MCP handles MCP HTTP routes.
type MCP struct {
	bridgeToken     string
	externalServer  MCPServerFactory
	documentServer  DocumentMCPServerFactory
	statelessLogger *slog.Logger
}

// NewMCP returns an MCP route handler.
func NewMCP(bridgeToken string, externalServer MCPServerFactory, documentServer DocumentMCPServerFactory) MCP {
	return MCP{
		bridgeToken:     bridgeToken,
		externalServer:  externalServer,
		documentServer:  documentServer,
		statelessLogger: slog.Default(),
	}
}

// HandleExternalMCP serves the cross-project MCP endpoint.
func (handler MCP) HandleExternalMCP(context *gin.Context) {
	slog.Debug(
		"external mcp http request",
		"method", context.Request.Method,
		"path", context.Request.URL.Path,
	)

	httpHandler := mcpserver.NewStatelessHTTPHandler(handler.externalServer, handler.statelessLogger)
	httpHandler.ServeHTTP(context.Writer, context.Request)
}

// HandleInternalDocumentMCP serves the agent document MCP endpoint.
func (handler MCP) HandleInternalDocumentMCP(context *gin.Context) {
	token := strings.TrimPrefix(context.GetHeader("Authorization"), "Bearer ")
	if handler.bridgeToken == "" || token != handler.bridgeToken {
		httpresponse.Error(context, http.StatusUnauthorized, "unauthorized document mcp request")
		return
	}

	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}

	slog.Debug(
		"document mcp http request",
		"method", context.Request.Method,
		"project_id", domain.DiagnosticProjectID(projectID),
		"session_id", context.Query("sessionId"),
		"run_id", context.Query("runId"),
	)

	httpHandler := mcpserver.NewStatelessHTTPHandler(func(request *http.Request) *mcpsdk.Server {
		if handler.documentServer == nil {
			return nil
		}
		return handler.documentServer(request, projectID)
	}, handler.statelessLogger)
	httpHandler.ServeHTTP(context.Writer, context.Request)
}
