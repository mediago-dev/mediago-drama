package generation

import (
	"context"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Options controls generation tool availability.
type Options struct {
	ProjectID string
}

// Dispatcher invokes typed host application generation services.
type Dispatcher interface {
	ListGenerationModels(ctx context.Context) (mediamcp.GenerationModelsOutput, error)
	CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error)
	GetGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationTaskRecord, error)
	ListGenerationTasks(ctx context.Context, projectID string, input mediamcp.GenerationTaskListInput) (mediamcp.GenerationTasksOutput, error)
	RetryGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationMessageOutput, error)
	PollGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationMessageOutput, error)
	SelectGenerationAsset(ctx context.Context, projectID string, input mediamcp.GenerationSelectAssetInput) (mediamcp.GenerationTaskRecord, error)
}

// Register installs generation tools on the MCP server.
func Register(server *mcpsdk.Server, dispatcher Dispatcher, options Options, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.GenerationListModelsInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.ListModels, func(ctx context.Context, dispatcher Dispatcher, _ string, input mediamcp.GenerationListModelsInput) (any, error) {
		_ = input
		return dispatcher.ListGenerationModels(ctx)
	})
	add[mediamcp.GenerationMessageInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.Generate, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationMessageInput) (any, error) {
		return dispatcher.CreateGenerationMessage(ctx, projectID, input)
	})
	add[mediamcp.GenerationTaskInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.GetTask, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationTaskInput) (any, error) {
		return dispatcher.GetGenerationTask(ctx, projectID, input)
	})
	add[mediamcp.GenerationTaskListInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.ListTasks, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationTaskListInput) (any, error) {
		return dispatcher.ListGenerationTasks(ctx, projectID, input)
	})
	add[mediamcp.GenerationTaskInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.RetryTask, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationTaskInput) (any, error) {
		return dispatcher.RetryGenerationTask(ctx, projectID, input)
	})
	add[mediamcp.GenerationTaskInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.PollTask, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationTaskInput) (any, error) {
		return dispatcher.PollGenerationTask(ctx, projectID, input)
	})
	add[mediamcp.GenerationSelectAssetInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.SelectAsset, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationSelectAssetInput) (any, error) {
		return dispatcher.SelectGenerationAsset(ctx, projectID, input)
	})
}

func add[In any](
	server *mcpsdk.Server,
	dispatcher Dispatcher,
	projectID string,
	closedWorld bool,
	logToolRegistered func(string),
	definition mediamcp.ToolDefinition,
	call func(context.Context, Dispatcher, string, In) (any, error),
) {
	handler := func(ctx context.Context, request *mcpsdk.CallToolRequest, input In) (*mcpsdk.CallToolResult, any, error) {
		_ = request
		output, err := call(ctx, dispatcher, projectID, input)
		return nil, output, err
	}
	mediamcp.AddTool(server, closedWorld, logToolRegistered, definition, handler)
}
