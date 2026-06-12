package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GenerationTaskRepository persists generation task state and attempts.
type GenerationTaskRepository struct {
	db *gorm.DB
}

const (
	defaultGenerationTaskListLimit  = 200
	maxGenerationTaskListLimit      = 500
	defaultPendingGenerationTaskCap = 10
	maxPendingGenerationTaskCap     = 100
)

// GenerationTaskListOptions bounds generation task list queries.
type GenerationTaskListOptions struct {
	Limit  int
	Offset int
}

// NewGenerationTaskRepository opens the settings database via the central settings schema owner.
func NewGenerationTaskRepository(dbPath string) (*GenerationTaskRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening generation task repository database: %w", err)
	}
	return NewGenerationTaskRepositoryFromDB(db), nil
}

// NewGenerationTaskRepositoryFromDB creates a repository from an existing settings DB.
func NewGenerationTaskRepositoryFromDB(db *gorm.DB) *GenerationTaskRepository {
	return &GenerationTaskRepository{db: db}
}

// ListGenerationTasks returns generation tasks ordered by last update.
func (repo *GenerationTaskRepository) ListGenerationTasks(options ...GenerationTaskListOptions) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	query := applyGenerationTaskListOptions(
		repo.db.Order("updated_at DESC"),
		firstGenerationTaskListOptions(options),
	)
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation tasks: %w", err)
	}
	return models, nil
}

// ListGenerationTasksByConversation returns generation tasks for one conversation.
func (repo *GenerationTaskRepository) ListGenerationTasksByConversation(kind string, conversationID string, includeLegacyDefault bool, options ...GenerationTaskListOptions) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	query := repo.db.Order("updated_at DESC")
	trimmedKind := strings.TrimSpace(kind)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	if trimmedConversationID != "" {
		if includeLegacyDefault {
			query = query.Where("(conversation_id = ? OR conversation_id = '')", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id = ''")
	}
	query = applyGenerationTaskListOptions(query, firstGenerationTaskListOptions(options))
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation tasks by conversation: %w", err)
	}
	return models, nil
}

// ListGenerationTasksByProject returns generation tasks for one project.
func (repo *GenerationTaskRepository) ListGenerationTasksByProject(kind string, projectID string, options ...GenerationTaskListOptions) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	query := repo.db.Order("updated_at DESC").Where("project_id = ?", domain.CleanProjectID(projectID))
	trimmedKind := strings.TrimSpace(kind)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	query = applyGenerationTaskListOptions(query, firstGenerationTaskListOptions(options))
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation tasks by project: %w", err)
	}
	return models, nil
}

// ListPendingGenerationTasks returns pending generation tasks for background polling.
func (repo *GenerationTaskRepository) ListPendingGenerationTasks(kind string, statuses []string, limit int) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	kind = strings.TrimSpace(kind)
	statuses = normalizeGenerationTaskStatuses(statuses)
	if kind == "" || len(statuses) == 0 {
		return models, nil
	}
	limit = normalizePendingGenerationTaskLimit(limit)
	if err := repo.db.
		Where("kind = ? AND status IN ?", kind, statuses).
		Order("updated_at ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing pending generation tasks: %w", err)
	}
	return models, nil
}

// GetGenerationTask returns a generation task by ID.
func (repo *GenerationTaskRepository) GetGenerationTask(id string) (domain.GenerationTaskModel, error) {
	var model domain.GenerationTaskModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationTaskModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationTaskModel{}, fmt.Errorf("getting generation task: %w", err)
	}
	return model, nil
}

// UpsertGenerationTask inserts or updates a generation task.
func (repo *GenerationTaskRepository) UpsertGenerationTask(model domain.GenerationTaskModel) error {
	model.ProjectID = domain.CleanProjectID(model.ProjectID)
	model.Status = normalizeGenerationTaskStatus(model.Status)
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"kind",
			"provider_task_id",
			"conversation_id",
			"project_id",
			"capability_id",
			"route_id",
			"family_id",
			"version_id",
			"provider",
			"model_id",
			"model",
			"prompt",
			"reference_urls_json",
			"reference_asset_ids_json",
			"params_json",
			"status",
			"message",
			"text",
			"assets_json",
			"usage_json",
			"error",
			"error_code",
			"error_type",
			"retryable",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting generation task: %w", err)
	}
	return nil
}

// UpsertGenerationConversation inserts or updates a generation conversation.
func (repo *GenerationTaskRepository) UpsertGenerationConversation(model domain.GenerationConversationModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"scope_id",
			"kind",
			"title",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting generation conversation: %w", err)
	}
	return nil
}

// ListGenerationConversations lists generation conversations for a scope and optional kind.
func (repo *GenerationTaskRepository) ListGenerationConversations(scopeID string, kind string) ([]domain.GenerationConversationModel, error) {
	models := []domain.GenerationConversationModel{}
	query := repo.db.Order("updated_at DESC, created_at DESC")
	if strings.TrimSpace(scopeID) != "" {
		query = query.Where("scope_id = ?", strings.TrimSpace(scopeID))
	}
	if strings.TrimSpace(kind) != "" {
		query = query.Where("kind = ?", strings.TrimSpace(kind))
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation conversations: %w", err)
	}
	return models, nil
}

// GetGenerationConversation returns one generation conversation.
func (repo *GenerationTaskRepository) GetGenerationConversation(id string) (domain.GenerationConversationModel, error) {
	var model domain.GenerationConversationModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationConversationModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationConversationModel{}, fmt.Errorf("getting generation conversation: %w", err)
	}
	return model, nil
}

// DeleteGenerationConversation deletes a generation conversation and its tasks.
func (repo *GenerationTaskRepository) DeleteGenerationConversation(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, fmt.Errorf("generation conversation id is required")
	}

	deleted := false
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		taskIDs := tx.Model(&domain.GenerationTaskModel{}).Select("id").Where("conversation_id = ?", id)
		if err := tx.Where("task_id IN (?)", taskIDs).Delete(&domain.GenerationTaskAttemptModel{}).Error; err != nil {
			return fmt.Errorf("deleting generation task attempts by conversation: %w", err)
		}
		if err := tx.Where("conversation_id = ?", id).Delete(&domain.GenerationTaskModel{}).Error; err != nil {
			return fmt.Errorf("deleting generation tasks by conversation: %w", err)
		}
		result := tx.Delete(&domain.GenerationConversationModel{}, "id = ?", id)
		if result.Error != nil {
			return fmt.Errorf("deleting generation conversation: %w", result.Error)
		}
		deleted = result.RowsAffected > 0
		return nil
	})
	if err != nil {
		return false, err
	}
	return deleted, nil
}

// CountGenerationTasksByConversation returns the number of tasks for a conversation.
func (repo *GenerationTaskRepository) CountGenerationTasksByConversation(kind string, conversationID string, includeLegacyDefault bool) (int64, error) {
	var count int64
	query := repo.db.Model(&domain.GenerationTaskModel{})
	trimmedKind := strings.TrimSpace(kind)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	if trimmedConversationID != "" {
		if includeLegacyDefault {
			query = query.Where("(conversation_id = ? OR conversation_id = '')", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id = ''")
	}
	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("counting generation tasks by conversation: %w", err)
	}
	return count, nil
}

// LatestGenerationTaskByConversation returns the most recent task in a conversation.
func (repo *GenerationTaskRepository) LatestGenerationTaskByConversation(kind string, conversationID string, includeLegacyDefault bool) (domain.GenerationTaskModel, error) {
	var model domain.GenerationTaskModel
	query := repo.db.Order("updated_at DESC")
	trimmedKind := strings.TrimSpace(kind)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	if trimmedConversationID != "" {
		if includeLegacyDefault {
			query = query.Where("(conversation_id = ? OR conversation_id = '')", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id = ''")
	}
	err := query.First(&model).Error
	if IsRecordNotFound(err) {
		return domain.GenerationTaskModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationTaskModel{}, fmt.Errorf("getting latest generation task by conversation: %w", err)
	}
	return model, nil
}

// RecordGenerationTaskError stores the latest task error message.
func (repo *GenerationTaskRepository) RecordGenerationTaskError(
	id string,
	errorMessage string,
	errorCode string,
	errorType string,
	retryable bool,
	updatedAt string,
) error {
	err := repo.db.Model(&domain.GenerationTaskModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(map[string]any{
			"error":      strings.TrimSpace(errorMessage),
			"error_code": strings.TrimSpace(errorCode),
			"error_type": strings.TrimSpace(errorType),
			"retryable":  retryable,
			"updated_at": updatedAt,
		}).Error
	if err != nil {
		return fmt.Errorf("recording generation task error: %w", err)
	}
	return nil
}

// CreateGenerationTaskAttempt inserts a generation task attempt.
func (repo *GenerationTaskRepository) CreateGenerationTaskAttempt(model domain.GenerationTaskAttemptModel) error {
	model.Status = normalizeGenerationTaskStatus(model.Status)
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating generation task attempt: %w", err)
	}
	return nil
}

// ListGenerationTaskAttempts returns recent attempts for a task.
func (repo *GenerationTaskRepository) ListGenerationTaskAttempts(taskID string, limit int) ([]domain.GenerationTaskAttemptModel, error) {
	models := []domain.GenerationTaskAttemptModel{}
	if err := repo.db.Where("task_id = ?", strings.TrimSpace(taskID)).
		Order("created_at DESC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation task attempts: %w", err)
	}
	return models, nil
}

// ListAllGenerationTaskAttempts returns all attempts for a task.
func (repo *GenerationTaskRepository) ListAllGenerationTaskAttempts(taskID string) ([]domain.GenerationTaskAttemptModel, error) {
	models := []domain.GenerationTaskAttemptModel{}
	if err := repo.db.Where("task_id = ?", strings.TrimSpace(taskID)).Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing all generation task attempts: %w", err)
	}
	return models, nil
}

// DeleteGenerationTask deletes a task and its attempts.
func (repo *GenerationTaskRepository) DeleteGenerationTask(id string) (bool, error) {
	result := repo.db.Delete(&domain.GenerationTaskModel{}, "id = ?", strings.TrimSpace(id))
	if result.Error != nil {
		return false, fmt.Errorf("deleting generation task: %w", result.Error)
	}
	deleted := result.RowsAffected > 0
	if deleted {
		if err := repo.db.Delete(&domain.GenerationTaskAttemptModel{}, "task_id = ?", strings.TrimSpace(id)).Error; err != nil {
			return false, fmt.Errorf("deleting generation task attempts: %w", err)
		}
	}
	return deleted, nil
}

func firstGenerationTaskListOptions(options []GenerationTaskListOptions) GenerationTaskListOptions {
	if len(options) == 0 {
		return GenerationTaskListOptions{}
	}
	return options[0]
}

func applyGenerationTaskListOptions(query *gorm.DB, options GenerationTaskListOptions) *gorm.DB {
	options = normalizeGenerationTaskListOptions(options)
	return query.Limit(options.Limit).Offset(options.Offset)
}

func normalizeGenerationTaskListOptions(options GenerationTaskListOptions) GenerationTaskListOptions {
	if options.Limit <= 0 {
		options.Limit = defaultGenerationTaskListLimit
	}
	if options.Limit > maxGenerationTaskListLimit {
		options.Limit = maxGenerationTaskListLimit
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	return options
}

func normalizePendingGenerationTaskLimit(limit int) int {
	if limit <= 0 {
		return defaultPendingGenerationTaskCap
	}
	if limit > maxPendingGenerationTaskCap {
		return maxPendingGenerationTaskCap
	}
	return limit
}

func normalizeGenerationTaskStatuses(statuses []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(statuses))
	for _, status := range statuses {
		status = normalizeGenerationTaskStatus(status)
		if status == "" {
			continue
		}
		if _, ok := seen[status]; ok {
			continue
		}
		seen[status] = struct{}{}
		normalized = append(normalized, status)
	}
	return normalized
}

func normalizeGenerationTaskStatus(status string) string {
	return strings.ToLower(strings.TrimSpace(status))
}
