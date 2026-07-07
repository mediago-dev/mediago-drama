package v2

import (
	"context"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
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
	AskUserSelection(ctx context.Context, projectID string, input mediamcp.AskUserSelectionInput) (mediamcp.AskUserSelectionOutput, error)
	AskUserForm(ctx context.Context, projectID string, input mediamcp.AskUserFormInput) (mediamcp.AskUserSelectionOutput, error)
	AwaitUserSelection(ctx context.Context, projectID string, input mediamcp.AwaitUserSelectionInput) (mediamcp.AskUserSelectionOutput, error)
}

// Register installs document V2 tools on the MCP server.
func Register(server *mcpsdk.Server, dispatcher Dispatcher, options Options, closedWorld bool, logToolRegistered func(string)) {
	registerLoadSkillTool(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
	registerProjectConfigTools(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
	registerCommentTools(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
	registerSelectionTools(server, dispatcher, options.ProjectID, closedWorld, logToolRegistered)
}

func registerSelectionTools(server *mcpsdk.Server, dispatcher Dispatcher, projectID string, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.AskUserSelectionInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.AskUserSelection, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.AskUserSelectionInput) (any, error) {
		return dispatcher.AskUserSelection(ctx, projectID, input)
	})
	add[mediamcp.AskUserFormInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.AskUserForm, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.AskUserFormInput) (any, error) {
		return dispatcher.AskUserForm(ctx, projectID, input)
	})
	add[mediamcp.AwaitUserSelectionInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.AwaitUserSelection, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.AwaitUserSelectionInput) (any, error) {
		return dispatcher.AwaitUserSelection(ctx, projectID, input)
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
