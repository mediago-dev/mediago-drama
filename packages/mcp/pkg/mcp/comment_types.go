package mcp

// CommentAnchorInput identifies where a comment should attach.
type CommentAnchorInput struct {
	BlockID string             `json:"blockId" jsonschema:"锚定块 ID。"`
	Range   *DocumentTextRange `json:"range,omitempty" jsonschema:"块内 UTF-16 code unit range。"`
	Quote   string             `json:"quote,omitempty" jsonschema:"锚定原文。"`
}

// ListCommentsInput filters comment threads for one document.
type ListCommentsInput struct {
	DocumentID     string `json:"documentId" jsonschema:"目标文档 ID。"`
	BlockID        string `json:"blockId,omitempty" jsonschema:"可选块 ID 过滤。"`
	Resolved       *bool  `json:"resolved,omitempty" jsonschema:"可选解决状态过滤。"`
	IncludeReplies *bool  `json:"includeReplies,omitempty" jsonschema:"是否包含 replies；默认 true。"`
}

// GetCommentInput reads one comment thread.
type GetCommentInput struct {
	CommentID      string `json:"commentId" jsonschema:"评论 ID。"`
	IncludeReplies *bool  `json:"includeReplies,omitempty" jsonschema:"是否包含 replies；默认 true。"`
}

// MutateCommentInput performs one comment mutation.
type MutateCommentInput struct {
	Op              string             `json:"op" jsonschema:"操作：add、update、reply、resolve、unresolve 或 delete。"`
	DocumentID      string             `json:"documentId,omitempty" jsonschema:"add 操作的目标文档 ID。"`
	Anchor          CommentAnchorInput `json:"anchor,omitempty" jsonschema:"add 操作的评论锚点。"`
	CommentID       string             `json:"commentId,omitempty" jsonschema:"update、resolve、unresolve、delete 操作的评论 ID。"`
	ParentCommentID string             `json:"parentCommentId,omitempty" jsonschema:"reply 操作的父评论 ID。"`
	Body            string             `json:"body,omitempty" jsonschema:"add、update、reply 操作的正文。"`
	Summary         string             `json:"summary,omitempty" jsonschema:"操作摘要。"`
}

// DocumentCommentThread contains one root comment and its replies.
type DocumentCommentThread struct {
	Root    DocumentComment   `json:"root"`
	Replies []DocumentComment `json:"replies,omitempty"`
}

// CommentsToolOutput is returned by list-comments tools.
type CommentsToolOutput struct {
	Threads []DocumentCommentThread `json:"threads"`
}

// CommentToolOutput is returned by get-comment tools.
type CommentToolOutput struct {
	Thread DocumentCommentThread `json:"thread"`
}

// CommentMutationOutput is returned by comment mutation tools.
type CommentMutationOutput struct {
	Thread     DocumentCommentThread `json:"thread"`
	DocumentID string                `json:"documentId"`
	Status     string                `json:"status"`
	Message    string                `json:"message"`
}
