package mcp

// DocumentRangeSelection identifies a selected text range inside one block.
type DocumentRangeSelection struct {
	BlockID string            `json:"blockId" jsonschema:"目标块 ID。"`
	Range   DocumentTextRange `json:"range" jsonschema:"块内纯文本 UTF-16 code unit 偏移范围。"`
	Quote   string            `json:"quote,omitempty" jsonschema:"可选选区原文，用于校验和展示。"`
}

// DocumentOffsetPosition identifies an inline insertion offset inside one block.
type DocumentOffsetPosition struct {
	BlockID string `json:"blockId" jsonschema:"目标块 ID。"`
	Offset  int    `json:"offset" jsonschema:"块内纯文本 UTF-16 code unit 偏移。"`
}

// DocumentBlockAnchorInput identifies a block-relative insertion anchor.
type DocumentBlockAnchorInput struct {
	BlockID  string `json:"blockId" jsonschema:"锚点块 ID。"`
	Position string `json:"position" jsonschema:"插入位置：before、after、firstChild 或 lastChild。"`
}

// DocumentMoveBlockTargetInput identifies where a block should be moved.
type DocumentMoveBlockTargetInput struct {
	DocumentID string                   `json:"documentId,omitempty" jsonschema:"可选目标文档 ID；省略表示当前文档。"`
	Anchor     DocumentBlockAnchorInput `json:"anchor" jsonschema:"目标锚点。"`
}

// DocumentBlockInput is a client-supplied block payload without server IDs or hashes.
type DocumentBlockInput struct {
	Kind     string              `json:"kind,omitempty" jsonschema:"块类型：heading、paragraph、list、listItem、code、quote、image、table、hr、html。"`
	Level    int                 `json:"level,omitempty" jsonschema:"heading 专用级别。"`
	Text     string              `json:"text,omitempty" jsonschema:"纯文本内容；当 markdown 为空时用于生成 Markdown。"`
	Markdown string              `json:"markdown,omitempty" jsonschema:"可选原始 Markdown 片段；优先用于回写。"`
	Attrs    *DocumentBlockAttrs `json:"attrs,omitempty" jsonschema:"块属性，如 code.language、list.ordered、image.src。"`
	Children []map[string]any    `json:"children,omitempty" jsonschema:"嵌套子块；每项形态同 BlockInput，id/range/hash 留空。"`
}

// DocumentInlineMarkInput describes an inline text mark.
type DocumentInlineMarkInput struct {
	Kind  string         `json:"kind" jsonschema:"mark 类型：bold、italic、code、link、highlight、strike。"`
	Attrs *LinkMarkAttrs `json:"attrs,omitempty" jsonschema:"mark 属性，如 link.href。"`
}

// DocumentInlineContentInput describes text or mention inline content.
type DocumentInlineContentInput struct {
	Type  string                    `json:"type" jsonschema:"inline 类型：text 或 mention。"`
	Text  string                    `json:"text,omitempty" jsonschema:"文本内容。"`
	Marks []DocumentInlineMarkInput `json:"marks,omitempty" jsonschema:"文本 marks。"`
	Attrs *MentionAttrs             `json:"attrs,omitempty" jsonschema:"mention/link 等属性。"`
}

// DocumentInlineReplacement is the replace_selection wire union: a plain
// string or an array of DocumentInlineContentInput.
type DocumentInlineReplacement any

// GetDocumentInput is the input for get_document.
type GetDocumentInput struct {
	DocumentID      string `json:"documentId" jsonschema:"目标文档 ID。"`
	IncludeComments *bool  `json:"includeComments,omitempty" jsonschema:"是否包含评论线程；默认 true。"`
	IncludeDraft    bool   `json:"includeDraft,omitempty" jsonschema:"是否包含 workbenchDraft；默认 false。"`
}

// GetDocumentOutput is the structured payload returned by get_document.
type GetDocumentOutput struct {
	ID             string                  `json:"id"`
	Title          string                  `json:"title"`
	Category       string                  `json:"category,omitempty"`
	ParentID       string                  `json:"parentId,omitempty"`
	SortOrder      int                     `json:"sortOrder"`
	Tags           []string                `json:"tags,omitempty"`
	Version        int                     `json:"version"`
	UpdatedAt      string                  `json:"updatedAt"`
	Structure      []DocumentBlockNode     `json:"structure"`
	Outline        []DocumentHeadingNode   `json:"outline"`
	Stats          DocumentStats           `json:"stats"`
	Comments       []DocumentCommentThread `json:"comments,omitempty"`
	WorkbenchDraft *DocumentWorkbenchDraft `json:"workbenchDraft,omitempty"`
}

// GetDocumentOutlineInput is the input for get_document_outline.
type GetDocumentOutlineInput struct {
	DocumentID string `json:"documentId" jsonschema:"目标文档 ID。"`
	MaxLevel   int    `json:"maxLevel,omitempty" jsonschema:"最大 heading 级别；默认 4。"`
}

// GetDocumentOutlineOutput is returned by get_document_outline.
type GetDocumentOutlineOutput struct {
	DocumentID string                `json:"documentId"`
	Version    int                   `json:"version"`
	Outline    []DocumentHeadingNode `json:"outline"`
}

// GetDocumentBlockInput is the input for get_document_block.
type GetDocumentBlockInput struct {
	DocumentID      string `json:"documentId" jsonschema:"目标文档 ID。"`
	BlockID         string `json:"blockId" jsonschema:"目标块 ID。"`
	IncludeChildren *bool  `json:"includeChildren,omitempty" jsonschema:"是否包含 children；默认 true。"`
}

// GetDocumentBlockOutput is returned by get_document_block.
type GetDocumentBlockOutput struct {
	Block         DocumentBlockNode `json:"block"`
	ParentID      string            `json:"parentId,omitempty"`
	PrevSiblingID string            `json:"prevSiblingId,omitempty"`
	NextSiblingID string            `json:"nextSiblingId,omitempty"`
}

// GetDocumentSectionInput is the input for get_document_section.
type GetDocumentSectionInput struct {
	DocumentID string `json:"documentId" jsonschema:"目标文档 ID。"`
	HeadingID  string `json:"headingId" jsonschema:"目标 heading ID。"`
}

// GetDocumentSectionOutput is returned by get_document_section.
type GetDocumentSectionOutput struct {
	Heading DocumentHeadingNode `json:"heading"`
	Blocks  []DocumentBlockNode `json:"blocks"`
}

// BatchGetDocumentsInput is the input for batch_get_documents.
type BatchGetDocumentsInput struct {
	DocumentIDs     []string `json:"documentIds" jsonschema:"目标文档 ID 列表。"`
	IncludeComments *bool    `json:"includeComments,omitempty" jsonschema:"是否包含评论线程；默认 true。"`
	AsStructure     *bool    `json:"asStructure,omitempty" jsonschema:"保留兼容字段；v2 总是返回结构化文档。"`
}

// BatchGetDocumentsOutput is returned by batch_get_documents.
type BatchGetDocumentsOutput struct {
	Documents []GetDocumentOutput `json:"documents"`
}

// WorkspaceSnapshotOutput is the current project workspace snapshot.
type WorkspaceSnapshotOutput struct {
	ProjectID        string                      `json:"projectId,omitempty"`
	ActiveDocumentID string                      `json:"activeDocumentId,omitempty"`
	Selection        *DocumentRangeSelection     `json:"selection,omitempty"`
	OpenDocumentIDs  []string                    `json:"openDocumentIds"`
	Documents        []WorkspaceDocumentMetadata `json:"documents"`
}

// LegacyWorkspaceSnapshotOutput is the compatibility workspace snapshot shape.
type LegacyWorkspaceSnapshotOutput struct {
	ProjectID        string                      `json:"projectId,omitempty"`
	ActiveDocumentID string                      `json:"activeDocumentId,omitempty"`
	SelectionText    string                      `json:"selectionText,omitempty"`
	Documents        []WorkspaceDocumentMetadata `json:"documents"`
}

// GetGuidelinesInput is the input for get_guidelines.
type GetGuidelinesInput struct {
	DocumentID string `json:"documentId,omitempty" jsonschema:"可选目标文档 ID，当前版本暂不按文档定制。"`
}

// GetGuidelinesOutput is returned by get_guidelines.
type GetGuidelinesOutput struct {
	Persona     string `json:"persona"`
	GlobalRules string `json:"globalRules"`
}

// LoadSkillInput selects one available agent skill.
type LoadSkillInput struct {
	Name string `json:"name" jsonschema:"要装载的 skill 名称。"`
}

// SkillMeta describes an available agent skill without its body.
type SkillMeta struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Source      string            `json:"source,omitempty"`
	TemplateID  string            `json:"templateId,omitempty"`
	Hint        map[string]string `json:"hint,omitempty"`
}

// LoadSkillOutput returns the requested skill body.
type LoadSkillOutput struct {
	Name      string            `json:"name"`
	Content   string            `json:"content"`
	Template  *DocumentTemplate `json:"template,omitempty"`
	Available []SkillMeta       `json:"available,omitempty"`
}

// DocumentTemplate describes a built-in document structure rule for a skill.
type DocumentTemplate struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Description      string `json:"description,omitempty"`
	DocumentCategory string `json:"documentCategory"`
	Content          string `json:"content,omitempty"`
}

// ListDocumentsInput is the input for list_documents.
type ListDocumentsInput struct{}

// WorkspaceSnapshotInput is the input for get_workspace_snapshot.
type WorkspaceSnapshotInput struct{}
