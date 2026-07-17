package domain

import "time"

// WorkspaceProjectModel is the GORM model for workspace projects.
type WorkspaceProjectModel struct {
	ID                 string     `gorm:"column:id;primaryKey"`
	Name               string     `gorm:"column:name;not null"`
	Category           string     `gorm:"column:category;not null;default:'agent';index:projects_category_idx"`
	Status             string     `gorm:"column:status;not null;default:'active';index:projects_status_idx"`
	Description        string     `gorm:"column:description;not null;default:''"`
	ProjectDir         string     `gorm:"column:project_dir;not null;default:''"`
	RelativeDir        string     `gorm:"column:relative_dir;not null"`
	OriginalProjectDir string     `gorm:"column:original_project_dir;not null;default:''"`
	TrashProjectDir    string     `gorm:"column:trash_project_dir;not null;default:''"`
	BriefJSON          *string    `gorm:"column:brief_json;type:text"`
	ArchivedAt         *time.Time `gorm:"column:archived_at"`
	TrashedAt          *time.Time `gorm:"column:trashed_at;index:projects_status_idx"`
	CreatedAt          time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt          time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (WorkspaceProjectModel) TableName() string {
	return "projects"
}

// EpisodeTimelineModel is the GORM model for persisted episode timeline state.
type EpisodeTimelineModel struct {
	ProjectID   string    `gorm:"column:project_id;primaryKey;default:'';index:episode_timelines_project_idx,priority:1"`
	DocumentID  string    `gorm:"column:document_id;primaryKey;index:episode_timelines_project_idx,priority:2"`
	EpisodeJSON string    `gorm:"column:episode_json;not null;type:text"`
	CreatedAt   time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano;index:episode_timelines_project_idx,priority:3,sort:desc"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (EpisodeTimelineModel) TableName() string {
	return "episode_timelines"
}

// DocumentOperationLogModel is the GORM model for document operation logs.
type DocumentOperationLogModel struct {
	ProjectID  string    `gorm:"column:project_id;primaryKey;default:'';index:document_operation_logs_project_idx,priority:1"`
	ID         string    `gorm:"column:id;primaryKey"`
	DocumentID string    `gorm:"column:document_id;not null"`
	RecordJSON string    `gorm:"column:record_json;not null"`
	CreatedAt  time.Time `gorm:"column:created_at;not null;autoCreateTime:nano;index:document_operation_logs_project_idx,priority:2,sort:desc"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (DocumentOperationLogModel) TableName() string {
	return "document_operation_logs"
}

// DocumentToolApprovalModel is the GORM model for document tool approvals.
type DocumentToolApprovalModel struct {
	ProjectID           string     `gorm:"column:project_id;primaryKey;default:'';index:document_tool_approvals_status_idx,priority:1"`
	ID                  string     `gorm:"column:id;primaryKey"`
	ToolName            string     `gorm:"column:tool_name;not null"`
	DocumentID          string     `gorm:"column:document_id;not null;default:''"`
	Title               string     `gorm:"column:title;not null;default:''"`
	Summary             string     `gorm:"column:summary;not null;default:''"`
	Status              string     `gorm:"column:status;not null;index:document_tool_approvals_status_idx,priority:2"`
	RequestJSON         string     `gorm:"column:request_json;not null"`
	DecisionPayloadJSON string     `gorm:"column:decision_payload_json;not null;default:''"`
	CreatedAt           time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano;index:document_tool_approvals_status_idx,priority:3,sort:asc"`
	DecidedAt           *time.Time `gorm:"column:decided_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (DocumentToolApprovalModel) TableName() string {
	return "document_tool_approvals"
}

// AgentSelectionModel is the GORM model for agent user-selection prompts.
type AgentSelectionModel struct {
	ProjectID                  string     `gorm:"column:project_id;primaryKey;default:'';index:agent_selections_status_idx,priority:1"`
	ID                         string     `gorm:"column:id;primaryKey"`
	SessionID                  string     `gorm:"column:session_id;not null;default:''"`
	RunID                      string     `gorm:"column:run_id;not null;default:''"`
	WorkflowID                 string     `gorm:"column:workflow_id;not null;default:'';index:agent_selections_workflow_status_idx,priority:1"`
	RequesterTaskID            string     `gorm:"column:requester_task_id;not null;default:''"`
	SourceInvocationID         string     `gorm:"column:source_invocation_id;not null;default:''"`
	RelayTaskID                string     `gorm:"column:relay_task_id;not null;default:''"`
	Kind                       string     `gorm:"column:kind;not null;default:''"`
	DecisionKind               string     `gorm:"column:decision_kind;not null;default:''"`
	Title                      string     `gorm:"column:title;not null;default:''"`
	Prompt                     string     `gorm:"column:prompt;not null;default:''"`
	OptionsJSON                string     `gorm:"column:options_json;not null;default:'[]'"`
	FieldsJSON                 string     `gorm:"column:fields_json;not null;default:''"`
	IntentJSON                 string     `gorm:"column:intent_json;not null;default:''"`
	AllowCustom                bool       `gorm:"column:allow_custom;not null;default:false"`
	Status                     string     `gorm:"column:status;not null;index:agent_selections_status_idx,priority:2;index:agent_selections_workflow_status_idx,priority:2"`
	DecisionJSON               string     `gorm:"column:decision_json;not null;default:''"`
	GenerationClaimFingerprint string     `gorm:"column:generation_claim_fingerprint;not null;default:''"`
	GenerationClaimedAt        *time.Time `gorm:"column:generation_claimed_at"`
	GenerationOutcomeJSON      string     `gorm:"column:generation_outcome_json;not null;default:''"`
	GenerationCompletedAt      *time.Time `gorm:"column:generation_completed_at"`
	ArtifactID                 string     `gorm:"column:artifact_id;not null;default:''"`
	ArtifactVersion            uint64     `gorm:"column:artifact_version;not null;default:0"`
	ArtifactRefVersion         string     `gorm:"column:artifact_ref_version;not null;default:''"`
	ArtifactRefFingerprint     string     `gorm:"column:artifact_ref_fingerprint;not null;default:''"`
	ResumeToken                *string    `gorm:"column:resume_token;uniqueIndex:agent_selections_resume_token_uidx"`
	RetentionMode              string     `gorm:"column:retention_mode;not null;default:'ephemeral'"`
	RetryOfSelectionID         *string    `gorm:"column:retry_of_selection_id"`
	SubmissionOwner            string     `gorm:"column:submission_owner;not null;default:'none'"`
	SupersededReason           string     `gorm:"column:superseded_reason;not null;default:''"`
	SupersededByVersion        string     `gorm:"column:superseded_by_version;not null;default:''"`
	SupersededAt               *time.Time `gorm:"column:superseded_at"`
	CreatedAt                  time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano;index:agent_selections_status_idx,priority:3,sort:asc"`
	DecidedAt                  *time.Time `gorm:"column:decided_at"`
	ExpiresAt                  *time.Time `gorm:"column:expires_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentSelectionModel) TableName() string {
	return "agent_selections"
}

// DocumentEditStreamModel is the GORM model for streamed document edits.
type DocumentEditStreamModel struct {
	ProjectID       string    `gorm:"column:project_id;primaryKey;default:'';index:document_edit_streams_project_idx,priority:1"`
	StreamID        string    `gorm:"column:stream_id;primaryKey"`
	DocumentID      string    `gorm:"column:document_id;not null;default:''"`
	Mode            string    `gorm:"column:mode;not null;default:''"`
	AnchorText      string    `gorm:"column:anchor_text;not null;default:''"`
	Title           string    `gorm:"column:title;not null;default:''"`
	ParentID        string    `gorm:"column:parent_id;not null;default:''"`
	BaseVersion     int       `gorm:"column:base_version;not null;default:0"`
	Buffer          string    `gorm:"column:buffer;not null;default:''"`
	Status          string    `gorm:"column:status;not null;default:'streaming';index:document_edit_streams_status_idx"`
	RunID           string    `gorm:"column:run_id;not null;default:''"`
	BeforeJSON      string    `gorm:"column:before_json;not null;default:''"`
	OperationLogged bool      `gorm:"column:operation_logged;not null;default:false"`
	CreatedAt       time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (DocumentEditStreamModel) TableName() string {
	return "document_edit_streams"
}

// DocumentSectionModel is the GORM model for stable Markdown section metadata.
type DocumentSectionModel struct {
	ProjectID     string     `gorm:"column:project_id;primaryKey;default:'';index:document_sections_project_document_idx,priority:1"`
	SectionID     string     `gorm:"column:section_id;primaryKey"`
	DocumentID    string     `gorm:"column:document_id;not null;default:'';index:document_sections_project_document_idx,priority:2"`
	Type          string     `gorm:"column:section_type;not null;default:'unknown';index:document_sections_type_idx"`
	Subtype       string     `gorm:"column:subtype;not null;default:''"`
	Title         string     `gorm:"column:title;not null;default:''"`
	MetadataJSON  string     `gorm:"column:metadata_json;not null;type:text;default:'{}'"`
	Status        string     `gorm:"column:status;not null;default:'active';index:document_sections_status_idx"`
	ObservedTitle string     `gorm:"column:observed_title;not null;default:''"`
	HeadingLevel  int        `gorm:"column:heading_level;not null;default:0"`
	HeadingPath   string     `gorm:"column:heading_path;not null;type:text;default:''"`
	LineStart     int        `gorm:"column:line_start;not null;default:0"`
	LineEnd       int        `gorm:"column:line_end;not null;default:0"`
	ContentHash   string     `gorm:"column:content_hash;not null;default:'';index:document_sections_content_hash_idx"`
	CreatedAt     time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt     time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	LastSeenAt    *time.Time `gorm:"column:last_seen_at;index:document_sections_last_seen_idx"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (DocumentSectionModel) TableName() string {
	return "document_sections"
}
