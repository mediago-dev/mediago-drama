package v2

import (
	"context"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func registerCommentTools(server *mcpsdk.Server, dispatcher Dispatcher, projectID string, closedWorld bool, logToolRegistered func(string)) {
	add[mediamcp.ListCommentsInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.DocumentTools.ListComments, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.ListCommentsInput) (any, error) {
		return dispatcher.ListComments(ctx, projectID, input)
	})
	add[mediamcp.GetCommentInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.DocumentTools.GetComment, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.GetCommentInput) (any, error) {
		return dispatcher.GetComment(ctx, projectID, input)
	})
	add[mediamcp.MutateCommentInput](server, dispatcher, projectID, closedWorld, logToolRegistered, mediamcp.DocumentTools.MutateComment, func(ctx context.Context, dispatcher Dispatcher, projectID string, input mediamcp.MutateCommentInput) (any, error) {
		return dispatcher.MutateComment(ctx, projectID, input)
	})
}
