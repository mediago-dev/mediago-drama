package mcp

import (
	"context"
	"fmt"
	"strings"

	mcpdocs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	cliservice "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

type addCommentInput struct {
	DocumentID string
	Anchor     mediamcp.CommentAnchorInput
	Body       string
	Summary    string
}

type updateCommentInput struct {
	CommentID string
	Body      string
	Summary   string
}

type replyCommentInput struct {
	ParentCommentID string
	Body            string
	Summary         string
}

type commentIDInput struct {
	CommentID string
	Summary   string
}

func (adapter *Adapter) findDocumentComment(projectID string, commentID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentComment, error) {
	if adapter == nil || adapter.store == nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, fmt.Errorf("workspace store is not configured")
	}
	projectID, err := adapter.normalizeProjectID(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, err
	}
	return adapter.store.FindWorkspaceDocumentComment(projectID, commentID)
}

func (adapter *Adapter) updateComments(
	server DocumentServer,
	document mediamcp.WorkspaceDocument,
	comments []mediamcp.DocumentComment,
	focusCommentID string,
	message string,
) (mediamcp.CommentMutationOutput, error) {
	updated, thread, err := adapter.store.UpdateWorkspaceDocumentComments(server.projectID, document, comments, focusCommentID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	server.publishDocumentEditLifecycle(cliservice.SnapshotDocument(document), updated, "", "", message, "")
	return mediamcp.CommentMutationOutput{Thread: thread, DocumentID: updated.ID, Status: "applied", Message: message}, nil
}

func (adapter *Adapter) setCommentResolved(server DocumentServer, commentID string, resolved bool, message string) (mediamcp.CommentMutationOutput, error) {
	document, comment, err := adapter.findDocumentComment(server.projectID, commentID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	comments, rootID := mcpdocs.SetDocumentCommentResolved(
		document,
		comment,
		resolved,
		server.commentAuthorID(),
		timestamp.NowRFC3339Nano(),
	)
	return adapter.updateComments(server, document, comments, rootID, message)
}

func (adapter *Adapter) ListComments(ctx context.Context, projectID string, input mediamcp.ListCommentsInput) (mediamcp.CommentsToolOutput, error) {
	_ = ctx
	document, err := adapter.getWorkspaceDocument(projectID, input.DocumentID)
	if err != nil {
		return mediamcp.CommentsToolOutput{}, err
	}
	return mediamcp.CommentsToolOutput{
		Threads: mcpdocs.FilterCommentThreads(
			document.Comments,
			input.BlockID,
			input.Resolved,
			mcpdocs.IncludeBoolDefault(input.IncludeReplies, true),
		),
	}, nil
}

func (adapter *Adapter) GetComment(ctx context.Context, projectID string, input mediamcp.GetCommentInput) (mediamcp.CommentToolOutput, error) {
	_ = ctx
	document, comment, err := adapter.findDocumentComment(projectID, input.CommentID)
	if err != nil {
		return mediamcp.CommentToolOutput{}, err
	}
	thread, ok := mcpdocs.CommentThreadFor(document.Comments, comment.ID, mcpdocs.IncludeBoolDefault(input.IncludeReplies, true))
	if !ok {
		return mediamcp.CommentToolOutput{}, fmt.Errorf("comment not found: %s", input.CommentID)
	}
	return mediamcp.CommentToolOutput{Thread: thread}, nil
}

func (adapter *Adapter) MutateComment(ctx context.Context, projectID string, input mediamcp.MutateCommentInput) (mediamcp.CommentMutationOutput, error) {
	switch strings.ToLower(strings.TrimSpace(input.Op)) {
	case "add":
		return adapter.addComment(ctx, projectID, addCommentInput{
			DocumentID: input.DocumentID,
			Anchor:     input.Anchor,
			Body:       input.Body,
			Summary:    input.Summary,
		})
	case "update":
		return adapter.updateComment(ctx, projectID, updateCommentInput{
			CommentID: input.CommentID,
			Body:      input.Body,
			Summary:   input.Summary,
		})
	case "reply":
		return adapter.replyComment(ctx, projectID, replyCommentInput{
			ParentCommentID: input.ParentCommentID,
			Body:            input.Body,
			Summary:         input.Summary,
		})
	case "resolve":
		return adapter.resolveComment(ctx, projectID, commentIDInput{
			CommentID: input.CommentID,
			Summary:   input.Summary,
		})
	case "unresolve":
		return adapter.unresolveComment(ctx, projectID, commentIDInput{
			CommentID: input.CommentID,
			Summary:   input.Summary,
		})
	case "delete":
		return adapter.deleteComment(ctx, projectID, commentIDInput{
			CommentID: input.CommentID,
			Summary:   input.Summary,
		})
	default:
		return mediamcp.CommentMutationOutput{}, fmt.Errorf("unsupported comment op: %s", input.Op)
	}
}

func (adapter *Adapter) addComment(ctx context.Context, projectID string, input addCommentInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	document, block, err := adapter.getWorkspaceDocumentBlock(server.projectID, input.DocumentID, input.Anchor.BlockID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	comments, commentID, err := mcpdocs.AddCommentToDocument(
		document,
		block,
		input.Anchor,
		input.Body,
		server.commentAuthorID(),
		mustRandomID("comment"),
		timestamp.NowRFC3339Nano(),
	)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	return adapter.updateComments(server, document, comments, commentID, firstNonEmpty(input.Summary, "已新增评论。"))
}

func (adapter *Adapter) updateComment(ctx context.Context, projectID string, input updateCommentInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	document, comment, err := adapter.findDocumentComment(server.projectID, input.CommentID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	comments, commentID, err := mcpdocs.UpdateDocumentCommentBody(document, comment, input.Body, timestamp.NowRFC3339Nano())
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	return adapter.updateComments(server, document, comments, commentID, firstNonEmpty(input.Summary, "已更新评论。"))
}

func (adapter *Adapter) replyComment(ctx context.Context, projectID string, input replyCommentInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	document, parent, err := adapter.findDocumentComment(server.projectID, input.ParentCommentID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	comments, rootID, err := mcpdocs.ReplyToDocumentComment(
		document,
		parent,
		input.Body,
		server.commentAuthorID(),
		mustRandomID("comment"),
		timestamp.NowRFC3339Nano(),
	)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	return adapter.updateComments(server, document, comments, rootID, firstNonEmpty(input.Summary, "已回复评论。"))
}

func (adapter *Adapter) resolveComment(ctx context.Context, projectID string, input commentIDInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	return adapter.setCommentResolved(server, input.CommentID, true, firstNonEmpty(input.Summary, "已解决评论线程。"))
}

func (adapter *Adapter) unresolveComment(ctx context.Context, projectID string, input commentIDInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	return adapter.setCommentResolved(server, input.CommentID, false, firstNonEmpty(input.Summary, "已重新打开评论线程。"))
}

func (adapter *Adapter) deleteComment(ctx context.Context, projectID string, input commentIDInput) (mediamcp.CommentMutationOutput, error) {
	_ = ctx
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	document, comment, err := adapter.findDocumentComment(server.projectID, input.CommentID)
	if err != nil {
		return mediamcp.CommentMutationOutput{}, err
	}
	comments, rootID := mcpdocs.DeleteDocumentCommentThread(document, comment, timestamp.NowRFC3339Nano())
	return adapter.updateComments(server, document, comments, rootID, firstNonEmpty(input.Summary, "已删除评论线程。"))
}
