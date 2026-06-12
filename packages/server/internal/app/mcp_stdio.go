package app

import (
	"context"
	"io"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	appevents "github.com/mediago-dev/mediago-drama/packages/server/internal/app/events"
	appmcp "github.com/mediago-dev/mediago-drama/packages/server/internal/app/mcp"
	appworkspace "github.com/mediago-dev/mediago-drama/packages/server/internal/app/workspace"
	serverconfig "github.com/mediago-dev/mediago-drama/packages/server/internal/config"
)

// RunDocumentMCP exposes MediaGo Drama document tools through the official MCP Go SDK.
func RunDocumentMCP(ctx context.Context, workspaceDir string, projectID string, config mediamcp.DocumentConfig, input io.Reader, output io.Writer) error {
	return appmcp.RunDocumentMCP(ctx, workspaceDir, projectID, appmcp.DocumentConfigFromProtocol(config), input, output)
}

// RunExternalMCP exposes project-scoped MediaGo Drama document tools through MCP stdio.
func RunExternalMCP(ctx context.Context, workspaceDir string, config serverconfig.InternalAPIConfig, input io.Reader, output io.Writer) error {
	return appmcp.RunExternalMCP(ctx, workspaceDir, appevents.NewHTTPEventPublisherFromConfig(config), input, output)
}

// ResolveWorkspaceDir returns the local MediaGo Drama workspace root used by the server.
func ResolveWorkspaceDir(workspaceDir string) string {
	return appworkspace.ResolveWorkspaceDir(workspaceDir)
}
