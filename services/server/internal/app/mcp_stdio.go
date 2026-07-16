package app

import (
	"context"
	"io"
	"os"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	appmcp "github.com/mediago-dev/mediago-drama/services/server/internal/app/mcp"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	serverconfig "github.com/mediago-dev/mediago-drama/services/server/internal/config"
)

// RunDocumentMCP exposes MediaGo Drama document tools through the official MCP Go SDK.
func RunDocumentMCP(ctx context.Context, workspaceDir string, projectID string, config mediamcp.DocumentConfig, input io.Reader, output io.Writer) error {
	return appmcp.RunDocumentMCP(ctx, workspaceDir, projectID, appmcp.DocumentConfigFromProtocol(config), input, output)
}

// RunExternalMCP exposes project-scoped MediaGo Drama document tools through MCP stdio.
func RunExternalMCP(ctx context.Context, workspaceDir string, config serverconfig.InternalAPIConfig, input io.Reader, output io.Writer) error {
	return appmcp.RunExternalMCP(ctx, workspaceDir, appevents.NewHTTPEventPublisherFromConfig(config), input, output)
}

// RunGenerationMCP exposes MediaGo Drama generation tools through MCP stdio.
func RunGenerationMCP(ctx context.Context, config Config, projectID string, input io.Reader, output io.Writer) error {
	api := newAPIHandler(config)
	defer func() {
		_ = api.Close()
	}()
	runConfig := mediamcp.DocumentConfigFromEnvVars(os.Getenv)
	server, _, err := appmcp.NewAgentGenerationServer(
		api.workspaceState.Dir(),
		projectID,
		api.generation,
		appmcp.GenerationRunContext{
			SessionID:  runConfig.SessionID,
			RunID:      runConfig.RunID,
			Selections: api.selection,
		},
		"stdio",
	)
	if err != nil {
		return err
	}
	return mediamcp.RunStdio(
		ctx,
		server,
		input,
		output,
		"generation mcp server stopped",
		"project_id", projectID,
		"transport", "stdio",
	)
}

// ResolveWorkspaceDir returns the local MediaGo Drama workspace root used by the server.
func ResolveWorkspaceDir(workspaceDir string) string {
	return appworkspace.ResolveWorkspaceDir(workspaceDir)
}
