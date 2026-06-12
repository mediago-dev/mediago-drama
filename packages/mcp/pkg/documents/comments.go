package documents

import (
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// BuildCommentThreads groups non-deleted comments into root threads.
func BuildCommentThreads(comments []mediamcp.DocumentComment, includeReplies bool) []mediamcp.DocumentCommentThread {
	roots := []mediamcp.DocumentComment{}
	replies := map[string][]mediamcp.DocumentComment{}
	for _, comment := range comments {
		if comment.DeletedAt != "" {
			continue
		}
		if comment.ParentCommentID == "" {
			roots = append(roots, comment)
		} else if includeReplies {
			replies[comment.ParentCommentID] = append(replies[comment.ParentCommentID], comment)
		}
	}
	threads := make([]mediamcp.DocumentCommentThread, 0, len(roots))
	for _, root := range roots {
		threads = append(threads, mediamcp.DocumentCommentThread{Root: root, Replies: replies[root.ID]})
	}
	return threads
}

// CommentThreadFor returns the thread containing commentID.
func CommentThreadFor(comments []mediamcp.DocumentComment, commentID string, includeReplies bool) (mediamcp.DocumentCommentThread, bool) {
	comment := FindCommentByID(comments, commentID)
	if comment == nil {
		return mediamcp.DocumentCommentThread{}, false
	}
	rootID := comment.ID
	if comment.ParentCommentID != "" {
		rootID = comment.ParentCommentID
	}
	for _, thread := range BuildCommentThreads(comments, includeReplies) {
		if thread.Root.ID == rootID {
			return thread, true
		}
	}
	return mediamcp.DocumentCommentThread{}, false
}

// MapDocumentComments maps one comment by ID.
func MapDocumentComments(comments []mediamcp.DocumentComment, commentID string, mapper func(mediamcp.DocumentComment) mediamcp.DocumentComment) []mediamcp.DocumentComment {
	next := append([]mediamcp.DocumentComment(nil), comments...)
	for index := range next {
		if next[index].ID == commentID {
			next[index] = mapper(next[index])
		}
	}
	return next
}

// MapCommentThread maps a root comment and its replies.
func MapCommentThread(comments []mediamcp.DocumentComment, rootID string, mapper func(mediamcp.DocumentComment) mediamcp.DocumentComment) []mediamcp.DocumentComment {
	next := append([]mediamcp.DocumentComment(nil), comments...)
	for index := range next {
		if next[index].ID == rootID || next[index].ParentCommentID == rootID {
			next[index] = mapper(next[index])
		}
	}
	return next
}

// FindCommentByID finds a non-deleted comment by ID.
func FindCommentByID(comments []mediamcp.DocumentComment, commentID string) *mediamcp.DocumentComment {
	for index := range comments {
		if comments[index].ID == commentID && comments[index].DeletedAt == "" {
			return &comments[index]
		}
	}
	return nil
}

// FilterCommentThreads returns comment threads matching the optional filters.
func FilterCommentThreads(comments []mediamcp.DocumentComment, blockID string, resolved *bool, includeReplies bool) []mediamcp.DocumentCommentThread {
	threads := BuildCommentThreads(comments, includeReplies)
	filtered := []mediamcp.DocumentCommentThread{}
	for _, thread := range threads {
		if blockID != "" && thread.Root.BlockID != blockID {
			continue
		}
		if resolved != nil && thread.Root.Resolved != *resolved {
			continue
		}
		filtered = append(filtered, thread)
	}
	return filtered
}

// AddCommentToDocument builds the next comment list for an added comment.
func AddCommentToDocument(
	document mediamcp.WorkspaceDocument,
	block mediamcp.DocumentBlockNode,
	anchorInput mediamcp.CommentAnchorInput,
	bodyInput string,
	authorID string,
	commentID string,
	now string,
) ([]mediamcp.DocumentComment, string, error) {
	body := strings.TrimSpace(bodyInput)
	if body == "" {
		return nil, "", fmt.Errorf("body is required")
	}
	quote := strings.TrimSpace(anchorInput.Quote)
	if quote == "" && anchorInput.Range != nil {
		if selected, ok := SelectedUTF16Text(block.Text, *anchorInput.Range); ok {
			quote = selected
		}
	}
	anchor := mediamcp.TextAnchor{Quote: quote, Range: anchorInput.Range}
	if anchor.Quote == "" {
		anchor = MakeTextAnchor(document.Content, block.Text)
	}
	comment := mediamcp.DocumentComment{
		ID:         commentID,
		DocumentID: document.ID,
		BlockID:    block.ID,
		AnchorText: FirstNonEmpty(quote, block.Text),
		Anchor:     anchor,
		Body:       body,
		AuthorID:   authorID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	return append([]mediamcp.DocumentComment{comment}, document.Comments...), comment.ID, nil
}

// UpdateDocumentCommentBody builds the next comment list for a body update.
func UpdateDocumentCommentBody(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, body string, now string) ([]mediamcp.DocumentComment, string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, "", fmt.Errorf("body is required")
	}
	comments := MapDocumentComments(document.Comments, comment.ID, func(next mediamcp.DocumentComment) mediamcp.DocumentComment {
		next.Body = body
		next.UpdatedAt = now
		return next
	})
	return comments, comment.ID, nil
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
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, "", fmt.Errorf("body is required")
	}
	rootID := CommentRootID(document.Comments, parent)
	if rootID != parent.ID {
		if root := FindCommentByID(document.Comments, rootID); root != nil {
			parent = *root
		}
	}
	reply := mediamcp.DocumentComment{
		ID:              commentID,
		DocumentID:      document.ID,
		BlockID:         parent.BlockID,
		AnchorText:      parent.AnchorText,
		Anchor:          parent.Anchor,
		Body:            body,
		AuthorID:        authorID,
		ParentCommentID: rootID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	return append(document.Comments, reply), rootID, nil
}

// SetDocumentCommentResolved builds the next comment list for resolve/unresolve.
func SetDocumentCommentResolved(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, resolved bool, authorID string, now string) ([]mediamcp.DocumentComment, string) {
	rootID := CommentRootID(document.Comments, comment)
	comments := MapCommentThread(document.Comments, rootID, func(next mediamcp.DocumentComment) mediamcp.DocumentComment {
		next.Resolved = resolved
		next.UpdatedAt = now
		if resolved {
			next.ResolvedBy = authorID
			next.ResolvedAt = now
		} else {
			next.ResolvedBy = ""
			next.ResolvedAt = ""
		}
		return next
	})
	return comments, rootID
}

// DeleteDocumentCommentThread builds the next comment list for a soft-deleted thread.
func DeleteDocumentCommentThread(document mediamcp.WorkspaceDocument, comment mediamcp.DocumentComment, now string) ([]mediamcp.DocumentComment, string) {
	rootID := CommentRootID(document.Comments, comment)
	comments := MapCommentThread(document.Comments, rootID, func(next mediamcp.DocumentComment) mediamcp.DocumentComment {
		next.DeletedAt = now
		next.UpdatedAt = now
		return next
	})
	return comments, rootID
}

// CommentRootID returns the root ID for a comment or reply.
func CommentRootID(comments []mediamcp.DocumentComment, comment mediamcp.DocumentComment) string {
	if strings.TrimSpace(comment.ParentCommentID) == "" {
		return comment.ID
	}
	rootID := comment.ParentCommentID
	if root := FindCommentByID(comments, rootID); root != nil {
		return root.ID
	}
	return rootID
}

// MakeTextAnchor creates a quote anchor with surrounding context.
func MakeTextAnchor(content string, quote string) mediamcp.TextAnchor {
	quote = strings.TrimSpace(quote)
	index := strings.Index(content, quote)
	if quote == "" || index < 0 {
		return mediamcp.TextAnchor{Quote: quote}
	}

	const contextLength = 72
	beforeStart := index - contextLength
	if beforeStart < 0 {
		beforeStart = 0
	}
	afterStart := index + len(quote)
	afterEnd := afterStart + contextLength
	if afterEnd > len(content) {
		afterEnd = len(content)
	}

	return mediamcp.TextAnchor{
		Quote:         quote,
		ContextBefore: content[beforeStart:index],
		ContextAfter:  content[afterStart:afterEnd],
	}
}
