package mcp

import "encoding/json"

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
	ID    string `json:"id"`
	Title string `json:"title"`
	// Filename is the document's actual on-disk markdown filename (relative to the work
	// directory), populated when loading from the local workspace. It lets the UI show the
	// exact file name instead of re-deriving one from the title.
	Filename       string                  `json:"filename,omitempty"`
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
	ID                 string                  `json:"id"`
	Name               string                  `json:"name"`
	Description        string                  `json:"description,omitempty"`
	Status             string                  `json:"status,omitempty"`
	ProjectDir         string                  `json:"projectDir,omitempty"`
	RelativeDir        string                  `json:"relativeDir,omitempty"`
	OriginalProjectDir string                  `json:"originalProjectDir,omitempty"`
	TrashProjectDir    string                  `json:"trashProjectDir,omitempty"`
	DocumentCount      int                     `json:"documentCount,omitempty"`
	ArchivedAt         string                  `json:"archivedAt,omitempty"`
	TrashedAt          string                  `json:"trashedAt,omitempty"`
	CreatedAt          string                  `json:"createdAt,omitempty"`
	UpdatedAt          string                  `json:"updatedAt,omitempty"`
	Production         *ProjectProductionState `json:"production,omitempty"`
	CoverAssetID       string                  `json:"coverAssetId,omitempty"`
	SortOrder          *int                    `json:"sortOrder,omitempty"`
}

// ProjectList is the external project listing payload.
type ProjectList struct {
	WorkspaceDir string    `json:"workspaceDir,omitempty"`
	DatabasePath string    `json:"databasePath,omitempty"`
	Projects     []Project `json:"projects"`
}

// ProjectOverviewConfig is the structured Overview page config.
type ProjectOverviewConfig struct {
	// CategoryDefaults maps a prompt category to a default preset id.
	CategoryDefaults map[string]string `json:"categoryDefaults,omitempty"`
	// Production stores the immutable template snapshot and mutable master production state.
	Production *ProjectProductionState `json:"production,omitempty"`
	// CoverAssetID is the explicit project cover selected by the user.
	CoverAssetID string `json:"coverAssetId,omitempty"`
	// SortOrder persists the user's project ordering in the workspace data.
	SortOrder *int `json:"sortOrder,omitempty"`
	// OutputDirectory is the optional local directory used for project exports.
	OutputDirectory string `json:"outputDirectory,omitempty"`
}

// ProjectProductionStage is one ordered stage copied from the selected template.
type ProjectProductionStage struct {
	ID         string   `json:"id"`
	Order      int      `json:"order"`
	Title      string   `json:"title"`
	Subtitle   string   `json:"subtitle"`
	Purpose    string   `json:"purpose"`
	Outputs    []string `json:"outputs"`
	Gate       string   `json:"gate"`
	Category   string   `json:"category"`
	Status     string   `json:"status,omitempty"`
	DocumentID string   `json:"documentId,omitempty"`
}

// ProjectProductionStageState stores mutable runtime state separately from the template snapshot.
type ProjectProductionStageState struct {
	// Status is retained for backwards compatibility with existing project.media.json files.
	Status       string `json:"status"`
	ManualStatus string `json:"manualStatus,omitempty"`
	AutoStatus   string `json:"autoStatus,omitempty"`
	DocumentID   string `json:"documentId"`
	Completion   *int   `json:"completion,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
	Blocker      string `json:"blocker,omitempty"`
}

// ProjectWorkbenchExecutionState stores the durable approval gate for one production stage.
// It deliberately lives beside stageStates so the template snapshot stays immutable while
// the user's analysis, confirmation and review history can evolve during production.
type ProjectWorkbenchExecutionState struct {
	Phase        string                        `json:"phase"`
	Analysis     *ProjectWorkbenchAnalysis     `json:"analysis,omitempty"`
	Confirmation *ProjectWorkbenchConfirmation `json:"confirmation,omitempty"`
	Execution    *ProjectWorkbenchExecution    `json:"execution,omitempty"`
	Review       *ProjectWorkbenchReview       `json:"review,omitempty"`
	Note         string                        `json:"note,omitempty"`
	UpdatedAt    string                        `json:"updatedAt,omitempty"`
}

// ProjectWorkbenchAnalysis is the evidence-first analysis result for a stage.
type ProjectWorkbenchAnalysis struct {
	Facts    []string `json:"facts,omitempty"`
	Unknowns []string `json:"unknowns,omitempty"`
	Risks    []string `json:"risks,omitempty"`
}

// ProjectWorkbenchConfirmation records the user's explicit approval to execute.
type ProjectWorkbenchConfirmation struct {
	Confirmed   bool   `json:"confirmed"`
	ConfirmedAt string `json:"confirmedAt,omitempty"`
}

// ProjectWorkbenchExecution records generation or production task ids launched after approval.
type ProjectWorkbenchExecution struct {
	TaskIDs   []string `json:"taskIds,omitempty"`
	StartedAt string   `json:"startedAt,omitempty"`
}

// ProjectWorkbenchReview records the latest human review decision.
type ProjectWorkbenchReview struct {
	Status     string `json:"status"`
	Notes      string `json:"notes,omitempty"`
	ReviewedAt string `json:"reviewedAt,omitempty"`
}

// ProjectReferenceImage stores the role assignment for one uploaded reference asset.
type ProjectReferenceImage struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Purposes []string `json:"purposes,omitempty"`
	URL      string   `json:"url,omitempty"`
}

// ProjectReferenceTransferState is the durable evidence-first reference migration workspace.
type ProjectReferenceTransferState struct {
	Draft                   json.RawMessage         `json:"draft,omitempty"`
	References              []ProjectReferenceImage `json:"references,omitempty"`
	StyleTransferDocumentID string                  `json:"styleTransferDocumentId,omitempty"`
	UpdatedAt               string                  `json:"updatedAt,omitempty"`
}

// ProjectTemplateSnapshot freezes the template definition used when a project was created.
type ProjectTemplateSnapshot struct {
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Category    string                   `json:"category"`
	Version     int                      `json:"version"`
	Stages      []ProjectProductionStage `json:"stages"`
}

// ProjectProductionState is the project-level production control state.
type ProjectProductionState struct {
	Template           ProjectTemplateSnapshot                   `json:"template"`
	StageStates        map[string]ProjectProductionStageState    `json:"stageStates,omitempty"`
	CurrentStageID     string                                    `json:"currentStageId,omitempty"`
	OverallProgress    int                                       `json:"overallProgress"`
	AspectRatio        string                                    `json:"aspectRatio,omitempty"`
	Resolution         string                                    `json:"resolution,omitempty"`
	TargetDuration     string                                    `json:"targetDuration,omitempty"`
	CoreAssetCount     int                                       `json:"coreAssetCount"`
	ShotCount          int                                       `json:"shotCount"`
	CompletedShotCount int                                       `json:"completedShotCount"`
	ReviewShotCount    int                                       `json:"reviewShotCount"`
	Version            string                                    `json:"version"`
	UpdatedAt          string                                    `json:"updatedAt"`
	Blockers           []string                                  `json:"blockers,omitempty"`
	NextAction         string                                    `json:"nextAction,omitempty"`
	WorkbenchStates    map[string]ProjectWorkbenchExecutionState `json:"workbenchStates,omitempty"`
	QCResults          map[string]ProjectQCResult                `json:"qcResults,omitempty"`
	Versions           []ProjectVersionRecord                    `json:"versions,omitempty"`
	OutputArchives     []ProjectOutputArchiveRecord              `json:"outputArchives,omitempty"`
	Retrospective      *ProjectRetrospective                     `json:"retrospective,omitempty"`
	SharedContext      *ProjectSharedContext                     `json:"sharedContext,omitempty"`
	ReferenceTransfer  *ProjectReferenceTransferState            `json:"referenceTransfer,omitempty"`
	ProductionGraph    *ProjectProductionGraph                   `json:"productionGraph,omitempty"`
	// Shots are the durable, ordered records created by splitting a confirmed
	// storyboard contact sheet into executable shot cards. Keeping them on the
	// canonical production state prevents the API's read/patch/write cycle from
	// silently dropping shot breakdown data.
	Shots []ProjectShotRecord `json:"shots,omitempty"`
}

type ProjectShotRecord struct {
	ID                  string                 `json:"id"`
	Sequence            int                    `json:"sequence"`
	ShotCode            string                 `json:"shotCode"`
	Title               string                 `json:"title"`
	StoryboardAssetID   string                 `json:"storyboardAssetId,omitempty"`
	StoryboardCrop      *ProjectStoryboardCrop `json:"storyboardCrop,omitempty"`
	StoryboardImagePath string                 `json:"storyboardImagePath,omitempty"`
	Description         string                 `json:"description,omitempty"`
	Prompt              string                 `json:"prompt,omitempty"`
	AssetIDs            []string               `json:"assetIds,omitempty"`
	Status              string                 `json:"status"`
	Completion          int                    `json:"completion"`
	FirstFrameAssetID   string                 `json:"firstFrameAssetId,omitempty"`
	LastFrameAssetID    string                 `json:"lastFrameAssetId,omitempty"`
	MotionPrompt        string                 `json:"motionPrompt,omitempty"`
	UpdatedAt           string                 `json:"updatedAt"`
}

type ProjectStoryboardCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// ProjectOutputArchiveRecord indexes a generated or imported file copied to the
// user's selected output directory. Keeping this in the project config makes
// output history recoverable after restarting the desktop app.
type ProjectOutputArchiveRecord struct {
	ID              string `json:"id"`
	TaskID          string `json:"taskId"`
	AssetID         string `json:"assetId,omitempty"`
	ShotID          string `json:"shotId,omitempty"`
	Version         string `json:"version,omitempty"`
	VersionID       string `json:"versionId,omitempty"`
	OutputDirectory string `json:"outputDirectory"`
	OutputPath      string `json:"outputPath"`
	Filename        string `json:"filename"`
	Kind            string `json:"kind"`
	CreatedAt       string `json:"createdAt"`
}

// ProjectProductionGraph preserves the lineage between references, prompts,
// assets, shots, generation tasks and final outputs.
type ProjectProductionGraph struct {
	Nodes     []ProjectProductionGraphNode `json:"nodes"`
	Edges     []ProjectProductionGraphEdge `json:"edges"`
	UpdatedAt string                       `json:"updatedAt"`
}

type ProjectProductionGraphNode struct {
	ID         string                 `json:"id"`
	Type       string                 `json:"type"`
	Title      string                 `json:"title"`
	AssetID    string                 `json:"assetId,omitempty"`
	DocumentID string                 `json:"documentId,omitempty"`
	ShotID     string                 `json:"shotId,omitempty"`
	TaskID     string                 `json:"taskId,omitempty"`
	VersionID  string                 `json:"versionId,omitempty"`
	Status     string                 `json:"status,omitempty"`
	Path       string                 `json:"path,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt  string                 `json:"createdAt"`
}

type ProjectProductionGraphEdge struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Relation  string `json:"relation"`
	CreatedAt string `json:"createdAt"`
}

// ProjectQCResult stores a structured review for one asset, shot, video, stage or output.
type ProjectQCResult struct {
	ID         string           `json:"id"`
	EntityType string           `json:"entityType"`
	EntityID   string           `json:"entityId"`
	StageID    string           `json:"stageId,omitempty"`
	Status     string           `json:"status"`
	Checks     []ProjectQCCheck `json:"checks,omitempty"`
	Issues     []string         `json:"issues,omitempty"`
	Reviewer   string           `json:"reviewer,omitempty"`
	ReviewedAt string           `json:"reviewedAt"`
	VersionID  string           `json:"versionId,omitempty"`
}

// ProjectQCCheck is one named quality check inside a QC result.
type ProjectQCCheck struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Status   string `json:"status"`
	Severity string `json:"severity,omitempty"`
	Note     string `json:"note,omitempty"`
}

// ProjectVersionRecord is a traceable asset, shot, task or output version.
type ProjectVersionRecord struct {
	ID             string                 `json:"id"`
	EntityType     string                 `json:"entityType"`
	EntityID       string                 `json:"entityId"`
	Version        string                 `json:"version"`
	Status         string                 `json:"status"`
	Label          string                 `json:"label,omitempty"`
	Prompt         string                 `json:"prompt,omitempty"`
	NegativePrompt string                 `json:"negativePrompt,omitempty"`
	Model          string                 `json:"model,omitempty"`
	Provider       string                 `json:"provider,omitempty"`
	Params         map[string]interface{} `json:"params,omitempty"`
	ReferenceIDs   []string               `json:"referenceIds,omitempty"`
	OutputPath     string                 `json:"outputPath,omitempty"`
	Note           string                 `json:"note,omitempty"`
	CreatedAt      string                 `json:"createdAt"`
	UpdatedAt      string                 `json:"updatedAt,omitempty"`
}

// ProjectRetrospective stores reusable learnings from a finished project.
type ProjectRetrospective struct {
	Status           string   `json:"status"`
	Conclusion       string   `json:"conclusion,omitempty"`
	Successes        []string `json:"successes,omitempty"`
	Failures         []string `json:"failures,omitempty"`
	ReusablePrompts  []string `json:"reusablePrompts,omitempty"`
	ReusableRules    []string `json:"reusableRules,omitempty"`
	NextProjectNotes []string `json:"nextProjectNotes,omitempty"`
	UpdatedAt        string   `json:"updatedAt"`
}

// ProjectSharedContext is the shared memory available to every stage in a project.
type ProjectSharedContext struct {
	ProjectBrief      string                 `json:"projectBrief,omitempty"`
	StoryOutline      string                 `json:"storyOutline,omitempty"`
	Script            string                 `json:"script,omitempty"`
	StoryboardBrief   string                 `json:"storyboardBrief,omitempty"`
	ShotBreakdown     string                 `json:"shotBreakdown,omitempty"`
	AssetPlan         string                 `json:"assetPlan,omitempty"`
	MotionPlan        string                 `json:"motionPlan,omitempty"`
	FinalReviewNotes  string                 `json:"finalReviewNotes,omitempty"`
	ApprovedContent   []string               `json:"approvedContent,omitempty"`
	RejectedContent   []string               `json:"rejectedContent,omitempty"`
	VisualDNA         map[string]interface{} `json:"visualDNA,omitempty"`
	Characters        []string               `json:"characters,omitempty"`
	Scenes            []string               `json:"scenes,omitempty"`
	Props             []string               `json:"props,omitempty"`
	ShotRules         []string               `json:"shotRules,omitempty"`
	References        []string               `json:"references,omitempty"`
	ApprovedAssets    []string               `json:"approvedAssets,omitempty"`
	Prompts           map[string]string      `json:"prompts,omitempty"`
	NegativePrompts   map[string]string      `json:"negativePrompts,omitempty"`
	GenerationHistory []string               `json:"generationHistory,omitempty"`
	Blockers          []string               `json:"blockers,omitempty"`
	ReviewNotes       []string               `json:"reviewNotes,omitempty"`
	OutputDirectory   string                 `json:"outputDirectory,omitempty"`
	UpdatedAt         string                 `json:"updatedAt,omitempty"`
}

// UnmarshalJSON accepts the legacy layerDefaults key while normalizing to CategoryDefaults.
func (config *ProjectOverviewConfig) UnmarshalJSON(data []byte) error {
	type projectOverviewConfigAlias ProjectOverviewConfig
	payload := struct {
		projectOverviewConfigAlias
		LegacyLayerDefaults map[string]string `json:"layerDefaults,omitempty"`
	}{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	*config = ProjectOverviewConfig(payload.projectOverviewConfigAlias)
	if len(config.CategoryDefaults) == 0 && len(payload.LegacyLayerDefaults) > 0 {
		config.CategoryDefaults = payload.LegacyLayerDefaults
	}
	return nil
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
	// CategoryDefaults, when provided, replaces the per-category default preset map.
	CategoryDefaults map[string]string       `json:"categoryDefaults,omitempty" jsonschema:"每分类默认预设：分类到预设 id；style 风格分类会被忽略。"`
	Production       *ProjectProductionState `json:"production,omitempty" jsonschema:"项目生产模板快照和总控状态。"`
	CoverAssetID     *string                 `json:"coverAssetId,omitempty" jsonschema:"项目封面资产 ID。"`
	SortOrder        *int                    `json:"sortOrder,omitempty" jsonschema:"项目在首页的排序位置。"`
	OutputDirectory  *string                 `json:"outputDirectory,omitempty" jsonschema:"项目生成结果的输出目录；为空时使用默认项目媒体目录。"`
}

// UnmarshalJSON accepts the legacy layerDefaults key while normalizing to CategoryDefaults.
func (patch *ProjectOverviewConfigPatch) UnmarshalJSON(data []byte) error {
	type projectOverviewConfigPatchAlias ProjectOverviewConfigPatch
	payload := struct {
		projectOverviewConfigPatchAlias
		LegacyLayerDefaults map[string]string `json:"layerDefaults,omitempty"`
	}{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	*patch = ProjectOverviewConfigPatch(payload.projectOverviewConfigPatchAlias)
	if len(patch.CategoryDefaults) == 0 && len(payload.LegacyLayerDefaults) > 0 {
		patch.CategoryDefaults = payload.LegacyLayerDefaults
	}
	return nil
}

// ProjectConfigPatchInput is a sparse project.media.json update.
type ProjectConfigPatchInput struct {
	Overview *ProjectOverviewConfigPatch `json:"overview,omitempty" jsonschema:"项目 Overview 配置。支持 categoryDefaults。"`
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
