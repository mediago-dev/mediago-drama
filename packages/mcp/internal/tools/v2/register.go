package v2

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// Options controls run-scoped document tool availability.
type Options struct {
	ProjectID string
}

// Dispatcher invokes typed host application document services.
type Dispatcher interface {
	LoadSkill(ctx context.Context, projectID string, input mediamcp.LoadSkillInput) (mediamcp.LoadSkillOutput, error)
	GetProjectConfig(ctx context.Context, projectID string) (mediamcp.ProjectConfigToolOutput, error)
	UpdateProjectConfig(ctx context.Context, projectID string, input mediamcp.ProjectConfigPatchInput) (mediamcp.ProjectConfigToolOutput, error)
	ListComments(ctx context.Context, projectID string, input mediamcp.ListCommentsInput) (mediamcp.CommentsToolOutput, error)
	GetComment(ctx context.Context, projectID string, input mediamcp.GetCommentInput) (mediamcp.CommentToolOutput, error)
	MutateComment(ctx context.Context, projectID string, input mediamcp.MutateCommentInput) (mediamcp.CommentMutationOutput, error)
}

// Register installs document V2 tools on the MCP server.
func Register(server *mcpsdk.Server, dispatcher Dispatcher, options Options, closedWorld bool, logToolRegistered func(string)) {
	registerLoadSkillTool(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
	registerProjectConfigTools(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
	registerCommentTools(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
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
