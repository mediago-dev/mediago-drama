package repository

import (
	"fmt"
	"strings"

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
	if err := repo.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model).Error; err != nil {
		return fmt.Errorf("upserting agent session: %w", err)
	}
	return nil
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
