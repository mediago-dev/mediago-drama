package handlers

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
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

// HandleExternalMCP godoc
// @Summary 外部 MCP 入口
// @Description 提供跨项目的 MCP streamable HTTP 入口。
// @Tags MCP
// @Accept json
// @Produce json
// @Param payload body SwaggerObject false "MCP JSON-RPC payload"
// @Success 200 {object} SwaggerEnvelope
// @Router /mcp [post]
func (handler MCP) HandleExternalMCP(context *gin.Context) {
	slog.Debug(
		"external mcp http request",
		"method", context.Request.Method,
		"path", context.Request.URL.Path,
	)

	httpHandler := mcpserver.NewStatelessHTTPHandler(handler.externalServer, handler.statelessLogger)
	httpHandler.ServeHTTP(context.Writer, context.Request)
}

// HandleInternalDocumentMCP godoc
// @Summary 文档 MCP 入口
// @Description 提供当前 Agent 运行使用的文档工具 MCP streamable HTTP 入口。
// @Tags MCP
// @Accept json
// @Produce json
// @Param projectId query string true "Project ID"
// @Param payload body SwaggerObject false "MCP JSON-RPC payload"
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/internal/agent/document-mcp [post]
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

// HandleLegacyDocumentMCP godoc
// @Summary 旧版文档 MCP 入口
// @Description 兼容旧 Agent 进程使用的文档 MCP streamable HTTP 入口。
// @Tags MCP
// @Accept json
// @Produce json
// @Param projectId query string true "Project ID"
// @Param payload body SwaggerObject false "MCP JSON-RPC payload"
// @Success 200 {object} SwaggerEnvelope
// @Router /api/internal/agent/document-mcp [post]
func (handler MCP) HandleLegacyDocumentMCP(context *gin.Context) {
	handler.HandleInternalDocumentMCP(context)
}

// HandleProjectDocumentMCP godoc
// @Summary 项目文档 MCP 入口
// @Description 提供指定项目范围内的文档工具 MCP streamable HTTP 入口。
// @Tags MCP
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject false "MCP JSON-RPC payload"
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/internal/projects/{projectId}/agent/document-mcp [post]
func (handler MCP) HandleProjectDocumentMCP(context *gin.Context) {
	handler.HandleInternalDocumentMCP(context)
}
