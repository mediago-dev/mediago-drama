package domain

import "time"

// AgentSessionModel is the GORM model for persisted agent sessions.
type AgentSessionModel struct {
	SessionID              string     `gorm:"column:session_id;primaryKey"`
	ProjectID              string     `gorm:"column:project_id;not null;default:'';index:agent_sessions_project_idx"`
	Title                  string     `gorm:"column:title;not null;default:''"`
	ACPSessionID           string     `gorm:"column:acp_session_id;not null;default:''"`
	ACPInstructionHash     string     `gorm:"column:acp_instruction_hash;not null;default:''"`
	LastStatus             string     `gorm:"column:last_status;not null;default:'';index:agent_sessions_status_idx"`
	LastMessage            string     `gorm:"column:last_message;not null;default:''"`
	ActiveWorkflowID       *string    `gorm:"column:active_workflow_id;index:agent_sessions_active_workflow_idx"`
	PendingFinalDeliveryID *string    `gorm:"column:pending_final_delivery_id;index:agent_sessions_pending_final_idx"`
	Revision               uint64     `gorm:"column:revision;not null;default:0"`
	RootRunID              *string    `gorm:"column:root_run_id"`
	RootRunLeaseOwner      *string    `gorm:"column:root_run_lease_owner"`
	RootRunLeaseUntil      *time.Time `gorm:"column:root_run_lease_until"`
	RootRunLeaseToken      uint64     `gorm:"column:root_run_lease_token;not null;default:0"`
	UpdatedAt              time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentSessionModel) TableName() string {
	return "agent_sessions"
}
