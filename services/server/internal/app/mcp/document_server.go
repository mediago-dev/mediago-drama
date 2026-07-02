package mcp

import (
	"context"
	"io"
	"log/slog"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	"github.com/modelcontextprotocol/go-sdk/mcp"
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
	return NewDocumentServerWithSkillRegistry(workspaceDir, projectID, config, transport, nil)
}

// NewDocumentServerWithSkillRegistry creates a document-scoped MCP server with
// an explicit skill registry.
func NewDocumentServerWithSkillRegistry(
	workspaceDir string,
	projectID string,
	config DocumentConfig,
	transport string,
	skillRegistry *serviceskill.Registry,
) (*mcp.Server, *DocumentServer, error) {
	store := appworkspace.NewStateService(workspaceDir)
	if store.InitErr() != nil {
		return nil, nil, store.InitErr()
	}
	if skillRegistry == nil {
		skillRegistry = newSkillRegistryForWorkspace(store)
	}
	toolServer := &DocumentServer{
		store:         store,
		config:        config,
		projectID:     domain.CleanProjectID(projectID),
		skillRegistry: skillRegistry,
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

	adapter := NewAdapterWithSkillRegistry(store, toolServer.config.Events, skillRegistry)
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
	store         *appworkspace.WorkspaceStateService
	config        DocumentConfig
	projectID     string
	skillRegistry *serviceskill.Registry
}

func (server DocumentServer) logToolInvocation(toolName string, attrs ...any) {
	base := []any{
		"tool", toolName,
		"project_id", server.projectID,
		"agent_tag", server.config.AgentTag,
	}
	slog.Debug("document mcp tool invoked", append(base, attrs...)...)
}
