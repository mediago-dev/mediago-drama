package v2

import (
	"context"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func registerProjectConfigTools(server *mcpsdk.Server, dispatcher Dispatcher, projectID string, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.GetProjectConfigInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.GetProjectConfig, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GetProjectConfigInput) (any, error) {
		_ = input
		return dispatcher.GetProjectConfig(ctx, projectID)
	})
	add[mediamcp.ProjectConfigPatchInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.UpdateProjectConfig, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.ProjectConfigPatchInput) (any, error) {
		return dispatcher.UpdateProjectConfig(ctx, projectID, input)
	})
}
