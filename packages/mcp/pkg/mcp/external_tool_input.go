package mcp

// ExternalListProjectsInput is the input for the external list_projects tool.
type ExternalListProjectsInput struct{}

// ExternalListCommentsInput lists comments in one project.
type ExternalListCommentsInput struct {
	ProjectID      string `json:"projectId" jsonschema:"目标项目 ID。"`
	DocumentID     string `json:"documentId" jsonschema:"目标文档 ID。"`
	BlockID        string `json:"blockId,omitempty" jsonschema:"可选块 ID 过滤。"`
	Resolved       *bool  `json:"resolved,omitempty" jsonschema:"可选解决状态过滤。"`
	IncludeReplies *bool  `json:"includeReplies,omitempty" jsonschema:"是否包含 replies；默认 true。"`
}

// ExternalMutateCommentInput performs one comment mutation in one project.
type ExternalMutateCommentInput struct {
	ProjectID       string             `json:"projectId" jsonschema:"目标项目 ID。"`
	Op              string             `json:"op" jsonschema:"操作：add、update、reply、resolve、unresolve 或 delete。"`
	DocumentID      string             `json:"documentId,omitempty" jsonschema:"add 操作的目标文档 ID。"`
	Anchor          CommentAnchorInput `json:"anchor,omitempty" jsonschema:"add 操作的评论锚点。"`
	CommentID       string             `json:"commentId,omitempty" jsonschema:"update、resolve、unresolve、delete 操作的评论 ID。"`
	ParentCommentID string             `json:"parentCommentId,omitempty" jsonschema:"reply 操作的父评论 ID。"`
	Body            string             `json:"body,omitempty" jsonschema:"add、update、reply 操作的正文。"`
	Summary         string             `json:"summary,omitempty" jsonschema:"操作摘要。"`
}

// ExternalGetCommentInput reads one comment thread in one project.
type ExternalGetCommentInput struct {
	ProjectID      string `json:"projectId" jsonschema:"目标项目 ID。"`
	CommentID      string `json:"commentId" jsonschema:"评论 ID。"`
	IncludeReplies *bool  `json:"includeReplies,omitempty" jsonschema:"是否包含 replies；默认 true。"`
}
