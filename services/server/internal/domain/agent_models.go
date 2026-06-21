package domain

import "time"

// AgentSessionModel is the GORM model for persisted agent sessions.
type AgentSessionModel struct {
	SessionID    string `gorm:"column:session_id;primaryKey"`
	ProjectID    string `gorm:"column:project_id;not null;default:'';index:agent_sessions_project_idx"`
	Title        string `gorm:"column:title;not null;default:''"`
	ACPSessionID string `gorm:"column:acp_session_id;not null;default:''"`
	LastStatus   string `gorm:"column:last_status;not null;default:'';index:agent_sessions_status_idx"`
	LastMessage  string `gorm:"column:last_message;not null;default:''"`
	UpdatedAt    time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentSessionModel) TableName() string {
	return "agent_sessions"
}
