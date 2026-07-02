package mcp

import (
	"context"
	"io"
	"log/slog"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// RunExternalMCP exposes project-scoped MediaGo Drama document tools through MCP stdio.
func RunExternalMCP(ctx context.Context, workspaceDir string, events EventPublisher, input io.Reader, output io.Writer) error {
	server, toolServer, err := NewExternalServer(workspaceDir, "stdio", events)
	if err != nil {
		return err
	}

	return mediamcp.RunStdio(
		ctx,
		server,
		input,
		output,
		"external mcp server stopped",
		"workspace_dir", toolServer.store.Dir(),
		"transport", "stdio",
	)
}

// NewExternalServer creates an external project-scoped MCP server.
func NewExternalServer(workspaceDir string, transport string, events EventPublisher) (*mcp.Server, *ExternalServer, error) {
	return NewExternalServerWithSkillRegistry(workspaceDir, transport, events, nil)
}

// NewExternalServerWithSkillRegistry creates an external project-scoped MCP
// server with an explicit skill registry.
func NewExternalServerWithSkillRegistry(
	workspaceDir string,
	transport string,
	events EventPublisher,
	skillRegistry *serviceskill.Registry,
) (*mcp.Server, *ExternalServer, error) {
	store := appworkspace.NewStateService(workspaceDir)
	if store.InitErr() != nil {
		return nil, nil, store.InitErr()
	}
	if skillRegistry == nil {
		skillRegistry = newSkillRegistryForWorkspace(store)
	}
	toolServer := &ExternalServer{store: store, events: events, skillRegistry: skillRegistry}
	slog.Debug(
		"external mcp server starting",
		"workspace_dir", store.Dir(),
		"transport", transport,
		"has_events", events != nil,
	)

	adapter := NewAdapterWithSkillRegistry(store, events, skillRegistry)
	adapter.external = toolServer
	server, err := mcpserver.NewExternalServer(mcpserver.Config{
		WorkspaceDir: store.Dir(),
		Transport:    transport,
	}, adapter)
	if err != nil {
		return nil, nil, err
	}
	slog.Debug(
		"external mcp tools registered",
		"workspace_dir", store.Dir(),
		"transport", transport,
	)
	return server, toolServer, nil
}

// ExternalServer owns external MCP runtime state.
type ExternalServer struct {
	store         *appworkspace.WorkspaceStateService
	events        EventPublisher
	skillRegistry *serviceskill.Registry
}

func (server ExternalServer) logToolInvocation(toolName string, attrs ...any) {
	base := []any{"tool", toolName, "workspace_dir", server.store.Dir()}
	slog.Debug("external mcp tool invoked", append(base, attrs...)...)
}

// CleanExternalProjectID normalizes and validates an external project ID.
func CleanExternalProjectID(projectID string) (string, error) {
	return domain.CleanExternalProjectID(projectID)
}

func (server ExternalServer) documentServer(projectID string) (DocumentServer, error) {
	projectID, err := CleanExternalProjectID(projectID)
	if err != nil {
		return DocumentServer{}, err
	}
	return DocumentServer{
		store:         server.store,
		projectID:     projectID,
		skillRegistry: server.skillRegistry,
		config: DocumentConfig{
			AgentTag: "external",
			Events:   server.events,
		},
	}, nil
}
