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
	store := appworkspace.NewStateService(workspaceDir)
	if store.InitErr() != nil {
		return nil, nil, store.InitErr()
	}
	toolServer := &ExternalServer{store: store, events: events}
	slog.Debug(
		"external mcp server starting",
		"workspace_dir", store.Dir(),
		"transport", transport,
		"has_events", events != nil,
	)

	adapter := NewAdapter(store, events)
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
	store  *appworkspace.WorkspaceStateService
	events EventPublisher
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
		store:     server.store,
		projectID: projectID,
		config: DocumentConfig{
			AgentTag: "external",
			Events:   server.events,
		},
	}, nil
}
