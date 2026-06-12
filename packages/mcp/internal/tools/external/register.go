package external

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// Dispatcher invokes typed host application services for cross-project tools.
type Dispatcher interface {
	ListProjects(ctx context.Context) (mediamcp.ProjectList, error)
	LoadSkill(ctx context.Context, projectID string, input mediamcp.LoadSkillInput) (mediamcp.LoadSkillOutput, error)
	GetProjectConfig(ctx context.Context, projectID string) (mediamcp.ProjectConfigToolOutput, error)
	ListComments(ctx context.Context, projectID string, input mediamcp.ListCommentsInput) (mediamcp.CommentsToolOutput, error)
	GetComment(ctx context.Context, projectID string, input mediamcp.GetCommentInput) (mediamcp.CommentToolOutput, error)
	MutateComment(ctx context.Context, projectID string, input mediamcp.MutateCommentInput) (mediamcp.CommentMutationOutput, error)
}

// Register installs cross-project external tools on the MCP server.
func Register(server *mcpsdk.Server, dispatcher Dispatcher, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.ExternalListProjectsInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.ListProjects, func(ctx context.Context, input mediamcp.ExternalListProjectsInput) (any, error) {
		_ = input
		return dispatcher.ListProjects(ctx)
	})
	add[mediamcp.LoadSkillInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.LoadSkill, func(ctx context.Context, input mediamcp.LoadSkillInput) (any, error) {
		return dispatcher.LoadSkill(ctx, "", input)
	})
	add[mediamcp.ExternalGetProjectConfigInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.GetProjectConfig, func(ctx context.Context, input mediamcp.ExternalGetProjectConfigInput) (any, error) {
		return dispatcher.GetProjectConfig(ctx, input.ProjectID)
	})
	add[mediamcp.ExternalListCommentsInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.ListComments, func(ctx context.Context, input mediamcp.ExternalListCommentsInput) (any, error) {
		return dispatcher.ListComments(ctx, input.ProjectID, mediamcp.ListCommentsInput{
			DocumentID:     input.DocumentID,
			BlockID:        input.BlockID,
			Resolved:       input.Resolved,
			IncludeReplies: input.IncludeReplies,
		})
	})
	add[mediamcp.ExternalGetCommentInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.GetComment, func(ctx context.Context, input mediamcp.ExternalGetCommentInput) (any, error) {
		return dispatcher.GetComment(ctx, input.ProjectID, mediamcp.GetCommentInput{
			CommentID:      input.CommentID,
			IncludeReplies: input.IncludeReplies,
		})
	})
	add[mediamcp.ExternalMutateCommentInput](server, closedWorld, logToolRegistered, mediamcp.ExternalDocumentTools.MutateComment, func(ctx context.Context, input mediamcp.ExternalMutateCommentInput) (any, error) {
		return dispatcher.MutateComment(ctx, input.ProjectID, mediamcp.MutateCommentInput{
			Op:              input.Op,
			DocumentID:      input.DocumentID,
			Anchor:          input.Anchor,
			CommentID:       input.CommentID,
			ParentCommentID: input.ParentCommentID,
			Body:            input.Body,
			Summary:         input.Summary,
		})
	})
}

func add[In any](
	server *mcpsdk.Server,
	closedWorld bool,
	logToolRegistered func(string),
	definition mediamcp.ToolDefinition,
	call func(context.Context, In) (any, error),
) {
	handler := func(ctx context.Context, request *mcpsdk.CallToolRequest, input In) (*mcpsdk.CallToolResult, any, error) {
		_ = request
		output, err := call(ctx, input)
		return nil, output, err
	}
	mediamcp.AddTool(server, closedWorld, logToolRegistered, definition, handler)
}
