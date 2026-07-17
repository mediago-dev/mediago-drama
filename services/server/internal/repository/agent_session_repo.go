package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AgentSessionRepository persists agent session indexes and status.
type AgentSessionRepository struct {
	db *gorm.DB
}

// NewAgentSessionRepository creates an agent session repository.
func NewAgentSessionRepository(db *gorm.DB) *AgentSessionRepository {
	return &AgentSessionRepository{db: db}
}

// ReconcileInterruptedRuns marks in-flight sessions as paused after restart.
func (repo *AgentSessionRepository) ReconcileInterruptedRuns(statuses []string, message string, finishedAt string) error {
	if err := repo.db.Model(&domain.AgentSessionModel{}).
		Where("last_status IN ?", statuses).
		Updates(map[string]any{
			"last_status":  "paused",
			"last_message": message,
			"updated_at":   finishedAt,
		}).Error; err != nil {
		return fmt.Errorf("reconciling interrupted agent sessions: %w", err)
	}
	return nil
}

// UpsertAgentSession inserts or updates an agent session.
func (repo *AgentSessionRepository) UpsertAgentSession(model domain.AgentSessionModel) error {
	result := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "session_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title",
			"acp_session_id",
			"acp_instruction_hash",
			"last_status",
			"last_message",
			"updated_at",
		}),
		Where: clause.Where{Exprs: []clause.Expression{clause.Eq{
			Column: clause.Column{Table: "agent_sessions", Name: "project_id"},
			Value:  clause.Column{Table: "excluded", Name: "project_id"},
		}}},
	}).Create(&model)
	if result.Error != nil {
		return fmt.Errorf("upserting agent session: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrAgentCommandConflict
	}
	return nil
}

// CompareAndSwapWorkflowState atomically replaces the active workflow pointer
// and final-delivery barrier at an expected session revision.
func (repo *AgentSessionRepository) CompareAndSwapWorkflowState(
	ctx context.Context,
	projectID string,
	sessionID string,
	expectedActiveWorkflowID *string,
	nextActiveWorkflowID *string,
	pendingFinalDeliveryID *string,
	expectedRevision uint64,
) (bool, error) {
	query := repo.db.WithContext(ctx).Model(&domain.AgentSessionModel{}).
		Where("project_id = ? AND session_id = ? AND revision = ?", strings.TrimSpace(projectID), strings.TrimSpace(sessionID), expectedRevision)
	if expectedActiveWorkflowID == nil {
		query = query.Where("active_workflow_id IS NULL")
	} else {
		query = query.Where("active_workflow_id = ?", strings.TrimSpace(*expectedActiveWorkflowID))
	}
	result := query.Updates(map[string]any{
		"active_workflow_id":        nextActiveWorkflowID,
		"pending_final_delivery_id": pendingFinalDeliveryID,
		"revision":                  expectedRevision + 1,
	})
	if result.Error != nil {
		return false, fmt.Errorf("compare-and-swap agent session workflow state: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// ClaimRootRunLease claims an expired or empty persistent root-run lease and
// returns the new monotonic fence token.
func (repo *AgentSessionRepository) ClaimRootRunLease(
	ctx context.Context,
	projectID string,
	sessionID string,
	runID string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AgentSessionModel, bool, error) {
	projectID = strings.TrimSpace(projectID)
	sessionID = strings.TrimSpace(sessionID)
	runID = strings.TrimSpace(runID)
	owner = strings.TrimSpace(owner)
	if projectID == "" || sessionID == "" || runID == "" || owner == "" || !leaseUntil.After(now) {
		return domain.AgentSessionModel{}, false, ErrAgentInvalidCAS
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentSessionModel{}).
		Where("project_id = ? AND session_id = ?", projectID, sessionID).
		Where("root_run_lease_until IS NULL OR root_run_lease_until <= ?", now.UTC()).
		Updates(map[string]any{
			"root_run_id":          runID,
			"root_run_lease_owner": owner,
			"root_run_lease_until": leaseUntil.UTC(),
			"root_run_lease_token": gorm.Expr("root_run_lease_token + 1"),
		})
	if result.Error != nil {
		return domain.AgentSessionModel{}, false, fmt.Errorf("claiming root-run lease: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return domain.AgentSessionModel{}, false, nil
	}
	var model domain.AgentSessionModel
	if err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND session_id = ?", projectID, sessionID).Error; err != nil {
		return domain.AgentSessionModel{}, false, fmt.Errorf("reading claimed root-run lease: %w", err)
	}
	return model, true, nil
}

// ReleaseRootRunLease releases a root-run lease only for its current owner and
// fence token. The token is retained so a later claim always advances it.
func (repo *AgentSessionRepository) ReleaseRootRunLease(
	ctx context.Context,
	projectID string,
	sessionID string,
	owner string,
	leaseToken uint64,
) (bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(sessionID) == "" || strings.TrimSpace(owner) == "" || leaseToken == 0 {
		return false, ErrAgentInvalidCAS
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentSessionModel{}).
		Where(
			"project_id = ? AND session_id = ? AND root_run_lease_owner = ? AND root_run_lease_token = ?",
			strings.TrimSpace(projectID),
			strings.TrimSpace(sessionID),
			strings.TrimSpace(owner),
			leaseToken,
		).
		Updates(map[string]any{
			"root_run_id":          nil,
			"root_run_lease_owner": nil,
			"root_run_lease_until": nil,
		})
	if result.Error != nil {
		return false, fmt.Errorf("releasing root-run lease: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// GetAgentSession returns a session by ID.
func (repo *AgentSessionRepository) GetAgentSession(sessionID string) (domain.AgentSessionModel, error) {
	var model domain.AgentSessionModel
	err := repo.db.First(&model, "session_id = ?", strings.TrimSpace(sessionID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentSessionModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentSessionModel{}, fmt.Errorf("getting agent session: %w", err)
	}
	return model, nil
}

// FindLatestAgentSessionByProject returns the latest session for a project.
func (repo *AgentSessionRepository) FindLatestAgentSessionByProject(projectID string) (domain.AgentSessionModel, error) {
	var model domain.AgentSessionModel
	err := repo.db.Where("project_id = ?", strings.TrimSpace(projectID)).
		Order("updated_at DESC, session_id DESC").
		First(&model).Error
	if IsRecordNotFound(err) {
		return domain.AgentSessionModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentSessionModel{}, fmt.Errorf("finding agent session by project: %w", err)
	}
	return model, nil
}

// ListAgentSessions returns sessions ordered by recent update.
func (repo *AgentSessionRepository) ListAgentSessions(projectID string) ([]domain.AgentSessionModel, error) {
	models := []domain.AgentSessionModel{}
	query := repo.db.Model(&domain.AgentSessionModel{})
	if strings.TrimSpace(projectID) != "" {
		query = query.Where("project_id = ?", strings.TrimSpace(projectID))
	}
	if err := query.Order("updated_at DESC, session_id DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing agent sessions: %w", err)
	}
	return models, nil
}
