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
	CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error)
	CreateGenerationBatch(ctx context.Context, projectID string, input mediamcp.GenerationBatchInput) (mediamcp.GenerationBatchOutput, error)
}

// Register installs generation tools on the MCP server.
func Register(server *mcpsdk.Server, dispatcher Dispatcher, options Options, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.GenerationMessageInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.Generate, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationMessageInput) (any, error) {
		return dispatcher.CreateGenerationMessage(ctx, projectID, input)
	})
	add[mediamcp.GenerationBatchInput](server, dispatcher, options.ProjectID, closedWorld, logToolRegistered, mediamcp.GenerationTools.GenerateBatch, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GenerationBatchInput) (any, error) {
		return dispatcher.CreateGenerationBatch(ctx, projectID, input)
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
