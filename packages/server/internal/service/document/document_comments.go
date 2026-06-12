package document

import (
	"fmt"
	"strings"

	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// BuildCommentThreads groups non-deleted comments into root threads.
func BuildCommentThreads(comments []mediamcp.DocumentComment, includeReplies bool) []mediamcp.DocumentCommentThread {
	return docs.BuildCommentThreads(comments, includeReplies)
}

// CommentThreadFor returns the thread containing commentID.
func CommentThreadFor(comments []mediamcp.DocumentComment, commentID string, includeReplies bool) (mediamcp.DocumentCommentThread, bool) {
	return docs.CommentThreadFor(comments, commentID, includeReplies)
}

// MapDocumentComments maps one comment by ID.
func MapDocumentComments(comments []mediamcp.DocumentComment, commentID string, mapper func(mediamcp.DocumentComment) mediamcp.DocumentComment) []mediamcp.DocumentComment {
	return docs.MapDocumentComments(comments, commentID, mapper)
}

// MapCommentThread maps a root comment and its replies.
func MapCommentThread(comments []mediamcp.DocumentComment, rootID string, mapper func(mediamcp.DocumentComment) mediamcp.DocumentComment) []mediamcp.DocumentComment {
	return docs.MapCommentThread(comments, rootID, mapper)
}

// FindCommentByID finds a non-deleted comment by ID.
func FindCommentByID(comments []mediamcp.DocumentComment, commentID string) *mediamcp.DocumentComment {
	return docs.FindCommentByID(comments, commentID)
}

// FilterCommentThreads returns comment threads matching the optional filters.
func FilterCommentThreads(comments []mediamcp.DocumentComment, blockID string, resolved *bool, includeReplies bool) []mediamcp.DocumentCommentThread {
	return docs.FilterCommentThreads(comments, blockID, resolved, includeReplies)
}

// FindWorkspaceDocumentComment finds a non-deleted comment in project documents.
func (store *Service) FindWorkspaceDocumentComment(projectID string, commentID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentComment, error) {
	if store == nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, fmt.Errorf("workspace store is not configured")
	}
	commentID = strings.TrimSpace(commentID)
	if commentID == "" {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, fmt.Errorf("commentId is required")
	}
	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, err
	}
	for _, document := range state.Documents {
		for _, comment := range document.Comments {
			if comment.ID == commentID && comment.DeletedAt == "" {
				return document, comment, nil
			}
		}
	}
	return mediamcp.WorkspaceDocument{}, mediamcp.DocumentComment{}, fmt.Errorf("comment not found: %s", commentID)
}

// UpdateWorkspaceDocumentComments normalizes and persists one document's comments.
func (store *Service) UpdateWorkspaceDocumentComments(
	projectID string,
	document mediamcp.WorkspaceDocument,
	comments []mediamcp.DocumentComment,
	focusCommentID string,
) (mediamcp.WorkspaceDocument, mediamcp.DocumentCommentThread, error) {
	if store == nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentCommentThread{}, fmt.Errorf("workspace store is not configured")
	}
	clean := false
	comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, comments)
	updated, _, err := store.UpdateWorkspaceDocument(projectID, document.ID, updateWorkspaceDocumentRequest{
		Comments: &comments,
		IsDirty:  &clean,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentCommentThread{}, err
	}
	thread, _ := CommentThreadFor(updated.Comments, focusCommentID, true)
	return updated, thread, nil
}

// AddCommentToDocument builds the next comment list for an added comment.
func AddCommentToDocument(
	document mediamcp.WorkspaceDocument,
	block mediamcp.DocumentBlockNode,
	anchor mediamcp.CommentAnchorInput,
	body string,
	authorID string,
	commentID string,
	now string,
) ([]mediamcp.DocumentComment, string, error) {
	return docs.AddCommentToDocument(document, block, anchor, body, authorID, commentID, now)
}

// UpdateDocumentCommentBody builds the next comment list for a body update.
func UpdateDocumentCommentBody(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, body string, now string) ([]mediamcp.DocumentComment, string, error) {
	return docs.UpdateDocumentCommentBody(document, comment, body, now)
}

// ReplyToDocumentComment builds the next comment list for a reply.
func ReplyToDocumentComment(
	document mediamcp.WorkspaceDocument,
	parent mediamcp.DocumentComment,
	body string,
	authorID string,
	commentID string,
	now string,
) ([]mediamcp.DocumentComment, string, error) {
	return docs.ReplyToDocumentComment(document, parent, body, authorID, commentID, now)
}

// SetDocumentCommentResolved builds the next comment list for resolve/unresolve.
func SetDocumentCommentResolved(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, resolved bool, authorID string, now string) ([]mediamcp.DocumentComment, string) {
	return docs.SetDocumentCommentResolved(document, comment, resolved, authorID, now)
}

// DeleteDocumentCommentThread builds the next comment list for a soft-deleted thread.
func DeleteDocumentCommentThread(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, now string) ([]mediamcp.DocumentComment, string) {
	return docs.DeleteDocumentCommentThread(document, comment, now)
}

// CommentRootID returns the root ID for a comment or reply.
func CommentRootID(comments []mediamcp.DocumentComment, comment mediamcp.DocumentComment) string {
	return docs.CommentRootID(comments, comment)
}
