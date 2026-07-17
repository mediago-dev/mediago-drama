package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

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
	normalizeAgentSelectionModels(models)
	return models, nil
}

// CreateAgentSelection inserts an agent selection.
func (repo *AgentSelectionRepository) CreateAgentSelection(model domain.AgentSelectionModel) error {
	normalizeAgentSelectionModel(&model)
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating agent selection: %w", err)
	}
	return nil
}

// SupersedePendingByWorkflow atomically supersedes every pending selection in
// a workflow. It is also exposed as a transaction-aware primitive to the
// workflow unit of work.
func (repo *AgentSelectionRepository) SupersedePendingByWorkflow(
	ctx context.Context,
	projectID string,
	workflowID string,
	reason string,
	supersededByVersion string,
	now time.Time,
) (int64, error) {
	return supersedePendingAgentSelectionsByWorkflow(
		repo.db.WithContext(ctx),
		projectID,
		workflowID,
		reason,
		supersededByVersion,
		now,
	)
}

func supersedePendingAgentSelectionsByWorkflow(
	db *gorm.DB,
	projectID string,
	workflowID string,
	reason string,
	supersededByVersion string,
	now time.Time,
) (int64, error) {
	now = now.UTC()
	result := db.Model(&domain.AgentSelectionModel{}).
		Where(
			"project_id = ? AND workflow_id = ? AND status = ?",
			strings.TrimSpace(projectID),
			strings.TrimSpace(workflowID),
			"pending",
		).
		Updates(map[string]any{
			"status":                "superseded",
			"decided_at":            now,
			"superseded_reason":     strings.TrimSpace(reason),
			"superseded_by_version": strings.TrimSpace(supersededByVersion),
			"superseded_at":         now,
		})
	if result.Error != nil {
		return 0, fmt.Errorf("superseding pending agent selections by workflow: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// ClaimAgentSelectionGenerationUse atomically assigns an eligible, unclaimed
// generation confirmation to one normalized request fingerprint. Rows outside
// the exact project/session/run context, expired rows, empty-intent rows, and
// prior claims are left unchanged.
func (repo *AgentSelectionRepository) ClaimAgentSelectionGenerationUse(
	projectID string,
	sessionID string,
	runID string,
	selectionID string,
	fingerprint string,
	now time.Time,
) (bool, error) {
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where(
			`project_id = ? AND session_id = ? AND run_id = ? AND id = ? AND intent_json <> ''
				AND kind = ? AND status = ?
				AND generation_claim_fingerprint = '' AND generation_claimed_at IS NULL
				AND (expires_at IS NULL OR expires_at > ?)`,
			strings.TrimSpace(projectID),
			strings.TrimSpace(sessionID),
			strings.TrimSpace(runID),
			strings.TrimSpace(selectionID),
			"generation_plan",
			"submitted",
			now.UTC(),
		).
		Updates(map[string]any{
			"generation_claim_fingerprint": strings.TrimSpace(fingerprint),
			"generation_claimed_at":        now.UTC(),
		})
	if result.Error != nil {
		return false, fmt.Errorf("claiming agent selection generation use: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// CompleteAgentSelectionGenerationUse atomically stores the replayable outcome
// for the fingerprint that owns a selection. A completed outcome is immutable.
func (repo *AgentSelectionRepository) CompleteAgentSelectionGenerationUse(
	projectID string,
	selectionID string,
	fingerprint string,
	outcomeJSON string,
	now time.Time,
) (bool, error) {
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where(
			`project_id = ? AND id = ? AND generation_claim_fingerprint = ?
				AND generation_claimed_at IS NOT NULL AND generation_outcome_json = ''
				AND generation_completed_at IS NULL`,
			strings.TrimSpace(projectID),
			strings.TrimSpace(selectionID),
			strings.TrimSpace(fingerprint),
		).
		Updates(map[string]any{
			"generation_outcome_json": string(outcomeJSON),
			"generation_completed_at": now.UTC(),
		})
	if result.Error != nil {
		return false, fmt.Errorf("completing agent selection generation use: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// DecidePendingAgentSelection updates a pending selection and reports whether it changed.
// The status guard makes the update idempotent: only the first decision on a
// pending selection wins, so concurrent double-clicks cannot both succeed.
func (repo *AgentSelectionRepository) DecidePendingAgentSelection(projectID string, selectionID string, status string, now time.Time, decidedAt string, decisionJSON string) (bool, error) {
	updates := map[string]any{
		"status":     strings.TrimSpace(status),
		"decided_at": decidedAt,
	}
	if strings.TrimSpace(decisionJSON) != "" {
		updates["decision_json"] = decisionJSON
	}
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where(
			"project_id = ? AND id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)",
			strings.TrimSpace(projectID),
			strings.TrimSpace(selectionID),
			"pending",
			now.UTC(),
		).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("deciding agent selection: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// CancelPendingAgentSelectionsByRun atomically cancels every pending selection
// belonging to one run and reports how many records changed.
func (repo *AgentSelectionRepository) CancelPendingAgentSelectionsByRun(projectID string, runID string, decidedAt string, decisionJSON string) (int64, error) {
	updates := map[string]any{
		"status":        "cancelled",
		"decided_at":    decidedAt,
		"decision_json": decisionJSON,
	}
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where(
			"project_id = ? AND run_id = ? AND status = ?",
			strings.TrimSpace(projectID),
			strings.TrimSpace(runID),
			"pending",
		).
		Updates(updates)
	if result.Error != nil {
		return 0, fmt.Errorf("cancelling pending agent selections by run: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// ExpirePendingAgentSelectionsByRun atomically expires every pending selection
// belonging to one run and reports how many records changed.
func (repo *AgentSelectionRepository) ExpirePendingAgentSelectionsByRun(projectID string, runID string, decidedAt string) (int64, error) {
	result := repo.db.Model(&domain.AgentSelectionModel{}).
		Where(
			"project_id = ? AND run_id = ? AND status = ?",
			strings.TrimSpace(projectID),
			strings.TrimSpace(runID),
			"pending",
		).
		Updates(map[string]any{"status": "expired", "decided_at": decidedAt})
	if result.Error != nil {
		return 0, fmt.Errorf("expiring pending agent selections by run: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// ExpirePendingAgentSelections marks the given pending selections as expired.
// The status guard preserves any decision that landed between the sweep read
// and this update.
func (repo *AgentSelectionRepository) ExpirePendingAgentSelections(projectID string, selectionIDs []string, expiresBefore time.Time, decidedAt string) (int64, error) {
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
		Where(
			"project_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ? AND id IN ?",
			strings.TrimSpace(projectID),
			"pending",
			expiresBefore.UTC(),
			ids,
		).
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
	normalizeAgentSelectionModels(models)
	return models, nil
}

// ListDecidedAgentSelectionsBySession returns a session's decided selections
// (selected/custom/submitted), oldest first, for conversation-recap replay.
func (repo *AgentSelectionRepository) ListDecidedAgentSelectionsBySession(projectID string, sessionID string, limit int) ([]domain.AgentSelectionModel, error) {
	if limit <= 0 {
		limit = 20
	}
	models := []domain.AgentSelectionModel{}
	if err := repo.db.Where(
		"project_id = ? AND session_id = ? AND status IN ?",
		strings.TrimSpace(projectID),
		strings.TrimSpace(sessionID),
		[]string{"selected", "custom", "submitted"},
	).
		Order("decided_at DESC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing decided agent selections by session: %w", err)
	}
	for left, right := 0, len(models)-1; left < right; left, right = left+1, right-1 {
		models[left], models[right] = models[right], models[left]
	}
	normalizeAgentSelectionModels(models)
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
	normalizeAgentSelectionModel(&model)
	return model, nil
}

func normalizeAgentSelectionModels(models []domain.AgentSelectionModel) {
	for index := range models {
		normalizeAgentSelectionModel(&models[index])
	}
}

func normalizeAgentSelectionModel(model *domain.AgentSelectionModel) {
	if strings.TrimSpace(model.RetentionMode) == "" {
		model.RetentionMode = "ephemeral"
	}
	if strings.TrimSpace(model.SubmissionOwner) == "" {
		if strings.TrimSpace(model.Kind) == "generation_plan" {
			model.SubmissionOwner = "agent_mcp"
		} else {
			model.SubmissionOwner = "none"
		}
	}
}
