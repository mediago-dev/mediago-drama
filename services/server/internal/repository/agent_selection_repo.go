package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

// AgentSelectionRepository persists agent user-selection prompts.
type AgentSelectionRepository struct {
	db *gorm.DB
}

// NewAgentSelectionRepository creates an agent selection repository.
func NewAgentSelectionRepository(db *gorm.DB) *AgentSelectionRepository {
	return &AgentSelectionRepository{db: db}
}

// ListPendingAgentSelections returns pending selections for a project.
func (repo *AgentSelectionRepository) ListPendingAgentSelections(projectID string) ([]domain.AgentSelectionModel, error) {
	models := []domain.AgentSelectionModel{}
	if err := repo.db.Where("project_id = ? AND status = ?", strings.TrimSpace(projectID), "pending").
		Order("created_at ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing agent selections: %w", err)
	}
	return models, nil
}

// CreateAgentSelection inserts an agent selection.
func (repo *AgentSelectionRepository) CreateAgentSelection(model domain.AgentSelectionModel) error {
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating agent selection: %w", err)
	}
	return nil
}

// DecidePendingAgentSelection updates a pending selection and reports whether it changed.
// The status guard makes the update idempotent: only the first decision on a
// pending selection wins, so concurrent double-clicks cannot both succeed.
func (repo *AgentSelectionRepository) DecidePendingAgentSelection(projectID string, selectionID string, status string, decidedAt string, decisionJSON string) (bool, error) {
	updates := map[string]any{
		"status":     strings.TrimSpace(status),
		"decided_at": decidedAt,
	}
	if strings.TrimSpace(decisionJSON) != "" {
		updates["decision_json"] = decisionJSON
	}
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where("project_id = ? AND id = ? AND status = ?", strings.TrimSpace(projectID), strings.TrimSpace(selectionID), "pending").
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("deciding agent selection: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// ExpirePendingAgentSelections marks the given pending selections as expired.
// The status guard preserves any decision that landed between the sweep read
// and this update.
func (repo *AgentSelectionRepository) ExpirePendingAgentSelections(projectID string, selectionIDs []string, decidedAt string) (int64, error) {
	ids := make([]string, 0, len(selectionIDs))
	for _, id := range selectionIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where("project_id = ? AND status = ? AND id IN ?", strings.TrimSpace(projectID), "pending", ids).
		Updates(map[string]any{"status": "expired", "decided_at": decidedAt})
	if result.Error != nil {
		return 0, fmt.Errorf("expiring agent selections: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// ListAgentSelectionsByRun returns a run's selections, newest first.
func (repo *AgentSelectionRepository) ListAgentSelectionsByRun(projectID string, runID string, limit int) ([]domain.AgentSelectionModel, error) {
	if limit <= 0 {
		limit = 20
	}
	models := []domain.AgentSelectionModel{}
	if err := repo.db.Where("project_id = ? AND run_id = ?", strings.TrimSpace(projectID), strings.TrimSpace(runID)).
		Order("created_at DESC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing agent selections by run: %w", err)
	}
	return models, nil
}

// GetAgentSelection returns a selection by ID.
func (repo *AgentSelectionRepository) GetAgentSelection(projectID string, selectionID string) (domain.AgentSelectionModel, error) {
	var model domain.AgentSelectionModel
	err := repo.db.First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(selectionID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentSelectionModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentSelectionModel{}, fmt.Errorf("getting agent selection: %w", err)
	}
	return model, nil
}
