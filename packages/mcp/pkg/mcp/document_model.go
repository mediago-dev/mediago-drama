package mcp

// DocumentTextRange is a UTF-16 code-unit range within one document block.
type DocumentTextRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// DocumentLineRange is a one-based markdown line range in a document.
type DocumentLineRange struct {
	StartLine int `json:"startLine"`
	EndLine   int `json:"endLine"`
}

// DocumentBlockNode is a structured markdown block returned by read tools.
type DocumentBlockNode struct {
	ID       string              `json:"id"`
	Kind     string              `json:"kind"`
	Level    int                 `json:"level,omitempty"`
	Text     string              `json:"text,omitempty"`
	Markdown string              `json:"markdown"`
	Attrs    *DocumentBlockAttrs `json:"attrs,omitempty"`
	Children []DocumentBlockNode `json:"children,omitempty"`
	Range    DocumentLineRange   `json:"range"`
	Hash     string              `json:"hash"`
}

// DocumentHeadingNode is one heading entry in a document outline.
type DocumentHeadingNode struct {
	ID    string            `json:"id"`
	Text  string            `json:"text"`
	Level int               `json:"level"`
	Range DocumentLineRange `json:"range"`
	Hash  string            `json:"hash"`
}

// DocumentStats summarizes document content structure.
type DocumentStats struct {
	WordCount    int `json:"wordCount"`
	BlockCount   int `json:"blockCount"`
	HeadingCount int `json:"headingCount"`
}

// TextAnchor identifies text by quote, surrounding context, and optional range.
type TextAnchor struct {
	Quote         string             `json:"quote"`
	ContextBefore string             `json:"contextBefore"`
	ContextAfter  string             `json:"contextAfter"`
	Range         *DocumentTextRange `json:"range,omitempty"`
}

// DocumentComment is a persisted document comment or reply.
type DocumentComment struct {
	ID              string     `json:"id"`
	DocumentID      string     `json:"documentId,omitempty"`
	BlockID         string     `json:"blockId,omitempty"`
	AnchorText      string     `json:"anchorText"`
	Anchor          TextAnchor `json:"anchor"`
	Body            string     `json:"body"`
	AuthorID        string     `json:"authorId,omitempty"`
	ParentCommentID string     `json:"parentCommentId,omitempty"`
	CreatedAt       string     `json:"createdAt"`
	UpdatedAt       string     `json:"updatedAt,omitempty"`
	Resolved        bool       `json:"resolved"`
	ResolvedBy      string     `json:"resolvedBy,omitempty"`
	ResolvedAt      string     `json:"resolvedAt,omitempty"`
	DeletedAt       string     `json:"deletedAt,omitempty"`
}

// DocumentWorkbenchDraft links a document to an episode workbench draft.
type DocumentWorkbenchDraft struct {
	ID         string `json:"id"`
	DocumentID string `json:"documentId"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// WorkspaceDocument is the full document payload shared over MCP and HTTP.
type WorkspaceDocument struct {
	ID             string                  `json:"id"`
	Title          string                  `json:"title"`
	Content        string                  `json:"content"`
	Category       string                  `json:"category,omitempty"`
	ParentID       string                  `json:"parentId,omitempty"`
	FolderID       string                  `json:"folderId,omitempty"`
	SortOrder      int                     `json:"sortOrder"`
	Tags           []string                `json:"tags,omitempty"`
	UpdatedAt      string                  `json:"updatedAt"`
	IsDirty        bool                    `json:"isDirty"`
	Version        int                     `json:"version"`
	Comments       []DocumentComment       `json:"comments"`
	WorkbenchDraft *DocumentWorkbenchDraft `json:"workbenchDraft,omitempty"`
}

// WorkspaceDocumentMetadata is the list-view projection of a workspace document.
type WorkspaceDocumentMetadata struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Category  string   `json:"category,omitempty"`
	ParentID  string   `json:"parentId,omitempty"`
	FolderID  string   `json:"folderId,omitempty"`
	SortOrder int      `json:"sortOrder"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
	IsDirty   bool     `json:"isDirty,omitempty"`
	Version   int      `json:"version"`
	Tags      []string `json:"tags,omitempty"`
}

// DocumentFolder is a persisted folder in a workspace project's document tree.
type DocumentFolder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId,omitempty"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// Project is a MediaGo Drama project summary.
type Project struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Description        string `json:"description,omitempty"`
	Status             string `json:"status,omitempty"`
	ProjectDir         string `json:"projectDir,omitempty"`
	RelativeDir        string `json:"relativeDir,omitempty"`
	OriginalProjectDir string `json:"originalProjectDir,omitempty"`
	TrashProjectDir    string `json:"trashProjectDir,omitempty"`
	DocumentCount      int    `json:"documentCount,omitempty"`
	ArchivedAt         string `json:"archivedAt,omitempty"`
	TrashedAt          string `json:"trashedAt,omitempty"`
	CreatedAt          string `json:"createdAt,omitempty"`
	UpdatedAt          string `json:"updatedAt,omitempty"`
}

// ProjectList is the external project listing payload.
type ProjectList struct {
	WorkspaceDir string    `json:"workspaceDir,omitempty"`
	DatabasePath string    `json:"databasePath,omitempty"`
	Projects     []Project `json:"projects"`
}

// ProjectOverviewConfig is the structured Overview page config.
type ProjectOverviewConfig struct {
	Style string `json:"style"`
	// LayerDefaults maps a prompt layer (style/scene_style/tone) to a default preset id.
	LayerDefaults map[string]string `json:"layerDefaults,omitempty"`
}

// ProjectConfig is the canonical project.media.json contract.
type ProjectConfig struct {
	SchemaVersion int                   `json:"schemaVersion"`
	ProjectID     string                `json:"projectId"`
	Name          string                `json:"name"`
	Description   string                `json:"description"`
	Overview      ProjectOverviewConfig `json:"overview"`
	CreatedAt     string                `json:"createdAt"`
}

// GetProjectConfigInput is the run-scoped get-project-config tool input.
type GetProjectConfigInput struct{}

// ExternalGetProjectConfigInput is the external project-scoped get-project-config input.
type ExternalGetProjectConfigInput struct {
	ProjectID string `json:"projectId" jsonschema:"目标项目 ID。"`
}

// ProjectOverviewConfigPatch is a sparse Overview config update.
type ProjectOverviewConfigPatch struct {
	Style *string `json:"style,omitempty" jsonschema:"项目 Overview 的风格描述。"`
	// LayerDefaults, when provided, replaces the per-layer default preset map.
	LayerDefaults map[string]string `json:"layerDefaults,omitempty" jsonschema:"每层默认预设：层(style/scene_style/tone)到预设 id。"`
}

// ProjectConfigPatchInput is a sparse project.media.json update.
type ProjectConfigPatchInput struct {
	Overview *ProjectOverviewConfigPatch `json:"overview,omitempty" jsonschema:"项目 Overview 配置。当前仅支持 style。"`
}

// ProjectConfigToolOutput is returned by project config tools.
type ProjectConfigToolOutput struct {
	Status  string        `json:"status"`
	Message string        `json:"message"`
	Config  ProjectConfig `json:"config"`
}

// ProjectBrief is the project-level creative brief.
type ProjectBrief struct {
	Medium     string `json:"medium"`
	Genre      string `json:"genre"`
	Pacing     string `json:"pacing"`
	Audience   string `json:"audience"`
	Tone       string `json:"tone"`
	Style      string `json:"style"`
	References string `json:"references"`
	Notes      string `json:"notes"`
	UpdatedAt  string `json:"updatedAt"`
}

// ProjectBriefPatchInput is a sparse project brief update.
type ProjectBriefPatchInput struct {
	Medium     *string `json:"medium,omitempty" jsonschema:"项目媒介，自由文本；只在用户已明确回答后传入。"`
	Genre      *string `json:"genre,omitempty" jsonschema:"项目类型，自由文本；只在用户已明确回答后传入。"`
	Pacing     *string `json:"pacing,omitempty" jsonschema:"项目节奏，自由文本；只在用户已明确回答后传入。"`
	Audience   *string `json:"audience,omitempty" jsonschema:"目标受众，自由文本；只在用户已明确回答后传入。"`
	Tone       *string `json:"tone,omitempty" jsonschema:"项目基调，自由文本；只在用户已明确回答后传入。"`
	Style      *string `json:"style,omitempty" jsonschema:"视觉风格，自由文本；图片和视频生成时必须遵循。"`
	References *string `json:"references,omitempty" jsonschema:"参考作品或灵感，自由文本；只在用户已明确回答后传入。"`
	Notes      *string `json:"notes,omitempty" jsonschema:"其他约束，自由文本；只在用户已明确回答后传入。"`
}

// ProjectBriefToolOutput is returned after reading or updating a project brief.
type ProjectBriefToolOutput struct {
	Status  string       `json:"status"`
	Message string       `json:"message"`
	Brief   ProjectBrief `json:"brief"`
}

// GetProjectBriefInput is the internal get-project-brief tool input.
type GetProjectBriefInput struct{}

// ExternalGetProjectBriefInput is the external project-scoped get-project-brief input.
type ExternalGetProjectBriefInput struct {
	ProjectID string `json:"projectId" jsonschema:"目标项目 ID，可先调用 list_projects 获取。"`
}

// ExternalProjectBriefPatchInput is the external project-scoped project brief patch input.
type ExternalProjectBriefPatchInput struct {
	ProjectID string `json:"projectId" jsonschema:"目标项目 ID，可先调用 list_projects 获取。"`
	ProjectBriefPatchInput
}

// ListDocumentsOutput is the document list tool output.
type ListDocumentsOutput struct {
	WorkspaceDir string                      `json:"workspaceDir,omitempty"`
	ProjectID    string                      `json:"projectId,omitempty"`
	Documents    []WorkspaceDocumentMetadata `json:"documents"`
	Folders      []DocumentFolder            `json:"folders,omitempty"`
}
