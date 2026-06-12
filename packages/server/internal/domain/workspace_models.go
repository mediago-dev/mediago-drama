package domain

import "database/sql"

// WorkspaceProjectModel is the GORM model for workspace projects.
type WorkspaceProjectModel struct {
	ID          string         `gorm:"column:id;primaryKey"`
	Name        string         `gorm:"column:name;not null"`
	Category    string         `gorm:"column:category;not null;default:'agent';index:projects_category_idx"`
	Description string         `gorm:"column:description;not null;default:''"`
	ProjectDir  string         `gorm:"column:project_dir;not null;default:''"`
	RelativeDir string         `gorm:"column:relative_dir;not null"`
	BriefJSON   sql.NullString `gorm:"column:brief_json;type:text"`
	CreatedAt   string         `gorm:"column:created_at;not null"`
	UpdatedAt   string         `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (WorkspaceProjectModel) TableName() string {
	return "projects"
}

// EpisodeTimelineModel is the GORM model for persisted episode timeline state.
type EpisodeTimelineModel struct {
	ProjectID   string `gorm:"column:project_id;primaryKey;default:'';index:episode_timelines_project_idx,priority:1"`
	DocumentID  string `gorm:"column:document_id;primaryKey;index:episode_timelines_project_idx,priority:2"`
	EpisodeJSON string `gorm:"column:episode_json;not null;type:text"`
	CreatedAt   string `gorm:"column:created_at;not null"`
	UpdatedAt   string `gorm:"column:updated_at;not null;index:episode_timelines_project_idx,priority:3,sort:desc"`
}

// TableName returns the backing table name.
func (EpisodeTimelineModel) TableName() string {
	return "episode_timelines"
}

// DocumentOperationLogModel is the GORM model for document operation logs.
type DocumentOperationLogModel struct {
	ProjectID  string `gorm:"column:project_id;primaryKey;default:'';index:document_operation_logs_project_idx,priority:1"`
	ID         string `gorm:"column:id;primaryKey"`
	DocumentID string `gorm:"column:document_id;not null"`
	RecordJSON string `gorm:"column:record_json;not null"`
	CreatedAt  string `gorm:"column:created_at;not null;index:document_operation_logs_project_idx,priority:2,sort:desc"`
}

// TableName returns the backing table name.
func (DocumentOperationLogModel) TableName() string {
	return "document_operation_logs"
}

// DocumentToolApprovalModel is the GORM model for document tool approvals.
type DocumentToolApprovalModel struct {
	ProjectID           string `gorm:"column:project_id;primaryKey;default:'';index:document_tool_approvals_status_idx,priority:1"`
	ID                  string `gorm:"column:id;primaryKey"`
	ToolName            string `gorm:"column:tool_name;not null"`
	DocumentID          string `gorm:"column:document_id;not null;default:''"`
	Title               string `gorm:"column:title;not null;default:''"`
	Summary             string `gorm:"column:summary;not null;default:''"`
	Status              string `gorm:"column:status;not null;index:document_tool_approvals_status_idx,priority:2"`
	RequestJSON         string `gorm:"column:request_json;not null"`
	DecisionPayloadJSON string `gorm:"column:decision_payload_json;not null;default:''"`
	CreatedAt           string `gorm:"column:created_at;not null;index:document_tool_approvals_status_idx,priority:3,sort:asc"`
	DecidedAt           string `gorm:"column:decided_at;not null;default:''"`
}

// TableName returns the backing table name.
func (DocumentToolApprovalModel) TableName() string {
	return "document_tool_approvals"
}

// DocumentEditStreamModel is the GORM model for streamed document edits.
type DocumentEditStreamModel struct {
	ProjectID       string `gorm:"column:project_id;primaryKey;default:'';index:document_edit_streams_project_idx,priority:1"`
	StreamID        string `gorm:"column:stream_id;primaryKey"`
	DocumentID      string `gorm:"column:document_id;not null;default:''"`
	Mode            string `gorm:"column:mode;not null;default:''"`
	AnchorText      string `gorm:"column:anchor_text;not null;default:''"`
	Title           string `gorm:"column:title;not null;default:''"`
	ParentID        string `gorm:"column:parent_id;not null;default:''"`
	BaseVersion     int    `gorm:"column:base_version;not null;default:0"`
	Buffer          string `gorm:"column:buffer;not null;default:''"`
	Status          string `gorm:"column:status;not null;default:'streaming';index:document_edit_streams_status_idx"`
	RunID           string `gorm:"column:run_id;not null;default:''"`
	BeforeJSON      string `gorm:"column:before_json;not null;default:''"`
	OperationLogged bool   `gorm:"column:operation_logged;not null;default:false"`
	CreatedAt       string `gorm:"column:created_at;not null"`
	UpdatedAt       string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (DocumentEditStreamModel) TableName() string {
	return "document_edit_streams"
}
