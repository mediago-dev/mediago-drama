package mcp

import (
	"context"
	"io"
	"log/slog"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	mcpserver "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/server"
	appworkspace "github.com/torchstellar-team/mediago-drama/packages/server/internal/app/workspace"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	serviceagent "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
)

// RunDocumentMCP exposes MediaGo Drama document tools through the official MCP Go SDK.
func RunDocumentMCP(ctx context.Context, workspaceDir string, projectID string, config DocumentConfig, input io.Reader, output io.Writer) error {
	server, toolServer, err := NewDocumentServer(workspaceDir, projectID, config, "stdio")
	if err != nil {
		return err
	}

	return mediamcp.RunStdio(
		ctx,
		server,
		input,
		output,
		"document mcp server stopped",
		"project_id", toolServer.projectID,
		"transport", "stdio",
	)
}

// NewDocumentServer creates a document-scoped MCP server.
func NewDocumentServer(workspaceDir string, projectID string, config DocumentConfig, transport string) (*mcp.Server, *DocumentServer, error) {
	store := appworkspace.NewStateService(workspaceDir)
	if store.InitErr() != nil {
		return nil, nil, store.InitErr()
	}
	toolServer := &DocumentServer{
		store:     store,
		config:    config,
		projectID: domain.CleanProjectID(projectID),
	}
	toolServer.config.RolePersona = serviceagent.DefaultAgentPersona
	toolServer.config.AgentTag = firstNonEmpty(toolServer.config.AgentTag, serviceagent.DefaultAgentName)
	slog.Debug(
		"document mcp server starting",
		"project_id", toolServer.projectID,
		"transport", transport,
		"has_session", toolServer.config.SessionID != "",
		"has_bridge", toolServer.config.BridgeURL != "" && toolServer.config.BridgeToken != "",
	)

	adapter := NewAdapter(store, toolServer.config.Events)
	adapter.document = toolServer
	server, err := mcpserver.NewDocumentServer(mcpserver.Config{
		WorkspaceDir: store.Dir(),
		ProjectID:    toolServer.projectID,
		Transport:    transport,
		Document:     toolServer.config.protocolConfig(),
	}, adapter)
	if err != nil {
		return nil, nil, err
	}
	slog.Debug(
		"document mcp tools registered",
		"project_id", toolServer.projectID,
		"transport", transport,
	)
	return server, toolServer, nil
}

// DocumentServer owns document MCP runtime state.
type DocumentServer struct {
	store     *appworkspace.WorkspaceStateService
	config    DocumentConfig
	projectID string
}

func (server DocumentServer) logToolInvocation(toolName string, attrs ...any) {
	base := []any{
		"tool", toolName,
		"project_id", server.projectID,
		"agent_tag", server.config.AgentTag,
	}
	slog.Debug("document mcp tool invoked", append(base, attrs...)...)
}
