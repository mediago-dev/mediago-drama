package repository

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

type legacyAgentSession struct {
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

	Project domain.WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

func (legacyAgentSession) TableName() string { return "agent_sessions" }

func TestCodexMigrationPreservesLegacySessionsWithoutReusingProtocolIDs(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.WorkspaceProjectModel{}, &legacyAgentSession{}); err != nil {
		t.Fatal(err)
	}
	project := domain.WorkspaceProjectModel{ID: "project-legacy", Name: "历史项目", RelativeDir: "project-legacy"}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	legacy := legacyAgentSession{SessionID: "session-legacy", ProjectID: project.ID, Title: "历史聊天", ACPSessionID: "adapter-session", ACPInstructionHash: "adapter-hash", LastStatus: "completed"}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatal(err)
	}
	got, err := NewAgentSessionRepository(db).GetAgentSession(legacy.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != legacy.Title || got.ProjectID != project.ID || got.CodexThreadID != "" || got.CodexInstructionHash != "" {
		t.Fatalf("migration changed legacy identity: %#v", got)
	}
	var preserved legacyAgentSession
	if err := db.First(&preserved, "session_id = ?", legacy.SessionID).Error; err != nil {
		t.Fatal(err)
	}
	if preserved.ACPSessionID != legacy.ACPSessionID {
		t.Fatal("legacy data was destroyed")
	}
}
