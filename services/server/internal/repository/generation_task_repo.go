package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
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

// NewGenerationTaskRepository opens the workspace database via the central workspace schema owner.
func NewGenerationTaskRepository(dbPath string) (*GenerationTaskRepository, error) {
	db, err := OpenWorkspaceDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening generation task repository database: %w", err)
	}
	return NewGenerationTaskRepositoryFromDB(db), nil
}

// NewGenerationTaskRepositoryFromDB creates a repository from an existing workspace DB.
func NewGenerationTaskRepositoryFromDB(db *gorm.DB) *GenerationTaskRepository {
	return &GenerationTaskRepository{db: db}
}

func (repo *GenerationTaskRepository) generationTaskQuery() *gorm.DB {
	return repo.db.Preload("References").Preload("Assets.Asset.Project")
}

// ListGenerationTasks returns generation tasks ordered by last update.
func (repo *GenerationTaskRepository) ListGenerationTasks(options ...GenerationTaskListOptions) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	query := applyGenerationTaskListOptions(
		repo.generationTaskQuery().Order("updated_at DESC"),
		firstGenerationTaskListOptions(options),
	)
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation tasks: %w", err)
	}
	return models, nil
}

// ListAllGenerationTasks returns every generation task ordered by update time.
func (repo *GenerationTaskRepository) ListAllGenerationTasks() ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	if err := repo.generationTaskQuery().Order("updated_at DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing all generation tasks: %w", err)
	}
	return models, nil
}

// ListGenerationTasksByConversation returns generation tasks for one conversation.
func (repo *GenerationTaskRepository) ListGenerationTasksByConversation(kind string, conversationID string, includeLegacyDefault bool, options ...GenerationTaskListOptions) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	query := repo.generationTaskQuery().Order("updated_at DESC")
	trimmedKind := strings.TrimSpace(kind)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	if trimmedConversationID != "" {
		if includeLegacyDefault {
			query = query.Where("(conversation_id = ? OR conversation_id IS NULL)", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id IS NULL")
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
	query := repo.generationTaskQuery().Order("updated_at DESC").Where("project_id = ?", domain.CleanProjectID(projectID))
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

// GenerationSectionAssetCount is the number of stored generated assets for one document section.
type GenerationSectionAssetCount struct {
	DocumentID string `gorm:"column:document_id"`
	SectionID  string `gorm:"column:section_id"`
	Count      int    `gorm:"column:count"`
}

// CountGeneratedAssetsByProjectSection returns, per document section, the number of stored assets
// produced by successful generation tasks of the given kind in the project. Counting the asset rows
// (deleted slots are hard-deleted) yields the number of currently existing generated files.
func (repo *GenerationTaskRepository) CountGeneratedAssetsByProjectSection(projectID string, kind string) ([]GenerationSectionAssetCount, error) {
	projectID = domain.CleanProjectID(projectID)
	kind = strings.TrimSpace(kind)
	rows := []GenerationSectionAssetCount{}
	if projectID == "" || kind == "" {
		return rows, nil
	}
	if err := repo.db.
		Table("generation_task_assets").
		Select("generation_tasks.document_id AS document_id, generation_tasks.section_id AS section_id, COUNT(*) AS count").
		Joins("JOIN generation_tasks ON generation_tasks.id = generation_task_assets.task_id").
		Where("generation_tasks.project_id = ?", projectID).
		Where("generation_tasks.kind = ?", kind).
		// Keep in sync with isCompletedGenerationTaskStatus in the generation service.
		Where("LOWER(TRIM(generation_tasks.status)) IN ?", []string{"completed", "succeeded", "success"}).
		Where("generation_tasks.document_id IS NOT NULL AND TRIM(generation_tasks.document_id) <> ''").
		Where("generation_tasks.section_id IS NOT NULL AND TRIM(generation_tasks.section_id) <> ''").
		Group("generation_tasks.document_id, generation_tasks.section_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("counting generated %s assets by project section: %w", kind, err)
	}
	return rows, nil
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
	if err := repo.generationTaskQuery().
		Where("kind = ? AND status IN ?", kind, statuses).
		Order("updated_at ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing pending generation tasks: %w", err)
	}
	return models, nil
}

// ListGenerationTasksByKindRoutesAndStatuses returns tasks matching kind, route IDs, and statuses.
func (repo *GenerationTaskRepository) ListGenerationTasksByKindRoutesAndStatuses(kind string, routeIDs []string, statuses []string, limit int) ([]domain.GenerationTaskModel, error) {
	models := []domain.GenerationTaskModel{}
	kind = strings.TrimSpace(kind)
	routeIDs = normalizeGenerationTaskRouteIDs(routeIDs)
	statuses = normalizeGenerationTaskStatuses(statuses)
	if kind == "" || len(routeIDs) == 0 || len(statuses) == 0 {
		return models, nil
	}
	limit = normalizePendingGenerationTaskLimit(limit)
	if err := repo.generationTaskQuery().
		Where("kind = ? AND route_id IN ? AND status IN ?", kind, routeIDs, statuses).
		Order("updated_at ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation tasks by route and status: %w", err)
	}
	return models, nil
}

// GetGenerationTask returns a generation task by ID.
func (repo *GenerationTaskRepository) GetGenerationTask(id string) (domain.GenerationTaskModel, error) {
	var model domain.GenerationTaskModel
	err := repo.generationTaskQuery().First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationTaskModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationTaskModel{}, fmt.Errorf("getting generation task: %w", err)
	}
	return model, nil
}

// UpsertGenerationTask inserts or updates a generation task.
// GenerationTaskExists reports whether a generation task row currently exists. Background
// workers use it to avoid recreating a task that was deleted while it was still generating.
func (repo *GenerationTaskRepository) GenerationTaskExists(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}
	var count int64
	if err := repo.db.Model(&domain.GenerationTaskModel{}).
		Where("id = ?", id).
		Limit(1).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("checking generation task existence: %w", err)
	}
	return count > 0, nil
}

func (repo *GenerationTaskRepository) UpsertGenerationTask(model domain.GenerationTaskModel) error {
	model.ProjectID = domain.StringPtr(domain.CleanProjectID(domain.StringValue(model.ProjectID)))
	model.Status = normalizeGenerationTaskStatus(model.Status)
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"kind",
			"provider_task_id",
			"conversation_id",
			"project_id",
			"document_id",
			"section_id",
			"capability_id",
			"route_id",
			"family_id",
			"version_id",
			"provider",
			"model_id",
			"model",
			"prompt",
			"params_json",
			"status",
			"message",
			"text",
			"input_tokens",
			"output_tokens",
			"total_tokens",
			"reasoning_tokens",
			"cached_tokens",
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

// GetGenerationTaskStatus returns just the status column of one task.
func (repo *GenerationTaskRepository) GetGenerationTaskStatus(id string) (string, error) {
	var status string
	result := repo.db.Model(&domain.GenerationTaskModel{}).
		Select("status").
		Where("id = ?", strings.TrimSpace(id)).
		Take(&status)
	if result.Error == gorm.ErrRecordNotFound {
		return "", ErrRecordNotFound
	}
	if result.Error != nil {
		return "", fmt.Errorf("loading generation task status %s: %w", id, result.Error)
	}
	return status, nil
}

// UpdateGenerationTaskAssets updates a task's resource type and timestamp after asset rows change.
func (repo *GenerationTaskRepository) UpdateGenerationTaskAssets(id string, resourceType string, updatedAt string) (bool, error) {
	updates := map[string]any{
		"updated_at": domain.TimeFromString(updatedAt),
	}
	if resourceType = strings.TrimSpace(resourceType); resourceType != "" {
		updates["resource_type"] = domain.StringPtr(resourceType)
	}
	result := repo.db.Model(&domain.GenerationTaskModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("updating generation task assets: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// ReplaceGenerationTaskAssetRows replaces normalized asset rows for one task.
func (repo *GenerationTaskRepository) ReplaceGenerationTaskAssetRows(taskID string, rows []domain.GenerationTaskAssetModel) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}
	return repo.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&domain.GenerationTaskAssetModel{}, "task_id = ?", taskID).Error; err != nil {
			return fmt.Errorf("deleting generation task asset rows: %w", err)
		}
		filtered := make([]domain.GenerationTaskAssetModel, 0, len(rows))
		for _, row := range rows {
			if strings.TrimSpace(row.AssetID) == "" {
				return fmt.Errorf("generation task asset row for task %s slot %d is missing asset_id", row.TaskID, row.SlotIndex)
			}
			filtered = append(filtered, row)
		}
		if len(filtered) == 0 {
			return nil
		}
		if err := tx.Create(&filtered).Error; err != nil {
			return fmt.Errorf("creating generation task asset rows: %w", err)
		}
		return nil
	})
}

// DeleteGenerationTaskAssetSlot deletes one normalized generated output slot.
func (repo *GenerationTaskRepository) DeleteGenerationTaskAssetSlot(taskID string, slotIndex int) (bool, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || slotIndex < 0 {
		return false, nil
	}
	result := repo.db.Delete(&domain.GenerationTaskAssetModel{}, "task_id = ? AND slot_index = ?", taskID, slotIndex)
	if result.Error != nil {
		return false, fmt.Errorf("deleting generation task asset slot: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// ReplaceGenerationTaskReferenceRows replaces normalized input reference rows for one task.
func (repo *GenerationTaskRepository) ReplaceGenerationTaskReferenceRows(taskID string, rows []domain.GenerationTaskReferenceModel) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}
	return repo.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&domain.GenerationTaskReferenceModel{}, "task_id = ?", taskID).Error; err != nil {
			return fmt.Errorf("deleting generation task reference rows: %w", err)
		}
		filtered := make([]domain.GenerationTaskReferenceModel, 0, len(rows))
		for _, row := range rows {
			if domain.StringValue(row.AssetID) == "" && domain.StringValue(row.URL) == "" {
				continue
			}
			filtered = append(filtered, row)
		}
		if len(filtered) == 0 {
			return nil
		}
		if err := tx.Create(&filtered).Error; err != nil {
			return fmt.Errorf("creating generation task reference rows: %w", err)
		}
		return nil
	})
}

// ReplaceProjectSelectedAssetRowsForTask replaces selected project asset rows sourced from one task.
func (repo *GenerationTaskRepository) ReplaceProjectSelectedAssetRowsForTask(taskID string, rows []domain.ProjectSelectedAssetModel) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}
	return repo.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&domain.ProjectSelectedAssetModel{}, "source_task_id = ?", taskID).Error; err != nil {
			return fmt.Errorf("deleting project selected asset rows: %w", err)
		}
		if len(rows) == 0 {
			return nil
		}
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&rows).Error; err != nil {
			return fmt.Errorf("creating project selected asset rows: %w", err)
		}
		return nil
	})
}

// ListProjectSelectedAssets returns selected project assets.
func (repo *GenerationTaskRepository) ListProjectSelectedAssets(projectID string) ([]domain.ProjectSelectedAssetModel, error) {
	projectID = domain.CleanProjectID(projectID)
	models := []domain.ProjectSelectedAssetModel{}
	if projectID == "" {
		return models, nil
	}
	if err := repo.db.
		Preload("Asset.Project").
		Where("project_id = ?", projectID).
		Order("updated_at DESC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing project selected assets: %w", err)
	}
	return models, nil
}

// HasProjectSelectedAssetForResource reports whether a creative resource already has a selected asset of the requested kind.
func (repo *GenerationTaskRepository) HasProjectSelectedAssetForResource(projectID string, resourceType string, resourceID string, sourceDocumentID string, kind string) (bool, error) {
	projectID = domain.CleanProjectID(projectID)
	resourceType = strings.TrimSpace(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	sourceDocumentID = strings.TrimSpace(sourceDocumentID)
	kind = strings.TrimSpace(kind)
	if projectID == "" || resourceType == "" || resourceID == "" || kind == "" {
		return false, nil
	}

	query := repo.db.Model(&domain.ProjectSelectedAssetModel{}).
		Joins("JOIN assets ON assets.id = project_selected_assets.asset_id").
		Where(
			"project_selected_assets.project_id = ? AND project_selected_assets.resource_type = ? AND project_selected_assets.resource_id = ?",
			projectID,
			resourceType,
			resourceID,
		)
	query = query.Where("assets.kind = ?", kind)
	if sourceDocumentID != "" {
		query = query.Where(
			"(project_selected_assets.source_document_id IS NULL OR project_selected_assets.source_document_id = '' OR project_selected_assets.source_document_id = ?)",
			sourceDocumentID,
		)
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, fmt.Errorf("checking project selected asset for resource: %w", err)
	}
	return count > 0, nil
}

// GetProjectSelectedAsset returns one selected project asset by ID.
func (repo *GenerationTaskRepository) GetProjectSelectedAsset(id string) (domain.ProjectSelectedAssetModel, error) {
	var model domain.ProjectSelectedAssetModel
	err := repo.db.Preload("Asset.Project").First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.ProjectSelectedAssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.ProjectSelectedAssetModel{}, fmt.Errorf("getting project selected asset: %w", err)
	}
	return model, nil
}

// UpsertProjectSelectedAsset inserts or updates one selected project asset.
func (repo *GenerationTaskRepository) UpsertProjectSelectedAsset(model domain.ProjectSelectedAssetModel) error {
	model.ProjectID = domain.CleanProjectID(model.ProjectID)
	if strings.TrimSpace(model.ID) == "" || model.ProjectID == "" || strings.TrimSpace(model.AssetID) == "" {
		return nil
	}
	if err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"project_id",
			"resource_type",
			"resource_id",
			"resource_title",
			"asset_id",
			"source_type",
			"source_task_id",
			"source_slot_index",
			"source_document_id",
			"sort_order",
			"deleted_at",
			"updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("upserting project selected asset: %w", err)
	}
	return nil
}

// DeleteProjectSelectedAsset deletes one selected project asset by ID.
func (repo *GenerationTaskRepository) DeleteProjectSelectedAsset(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}
	result := repo.db.Delete(&domain.ProjectSelectedAssetModel{}, "id = ?", id)
	if result.Error != nil {
		return false, fmt.Errorf("deleting project selected asset: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// DeleteProjectSelectedAssetByTaskSlot deletes a generated selection by its normalized source.
func (repo *GenerationTaskRepository) DeleteProjectSelectedAssetByTaskSlot(projectID string, resourceType string, taskID string, slotIndex int) (bool, error) {
	projectID = domain.CleanProjectID(projectID)
	resourceType = strings.TrimSpace(resourceType)
	taskID = strings.TrimSpace(taskID)
	if projectID == "" || resourceType == "" || taskID == "" || slotIndex < 0 {
		return false, nil
	}
	result := repo.db.Delete(
		&domain.ProjectSelectedAssetModel{},
		"project_id = ? AND resource_type = ? AND source_task_id = ? AND source_slot_index = ?",
		projectID,
		resourceType,
		taskID,
		slotIndex,
	)
	if result.Error != nil {
		return false, fmt.Errorf("deleting project selected asset by task slot: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// UpdateGenerationTaskProjectID rewrites legacy project identifiers on tasks.
func (repo *GenerationTaskRepository) UpdateGenerationTaskProjectID(oldProjectID string, newProjectID string) (int64, error) {
	oldProjectID = domain.CleanProjectID(oldProjectID)
	newProjectID = domain.CleanProjectID(newProjectID)
	if oldProjectID == "" || newProjectID == "" || oldProjectID == newProjectID {
		return 0, nil
	}
	result := repo.db.Model(&domain.GenerationTaskModel{}).
		Where("project_id = ?", oldProjectID).
		Update("project_id", newProjectID)
	if result.Error != nil {
		return 0, fmt.Errorf("updating generation task project id: %w", result.Error)
	}
	return result.RowsAffected, nil
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
		if err := tx.Where("source_task_id IN (?)", taskIDs).Delete(&domain.ProjectSelectedAssetModel{}).Error; err != nil {
			return fmt.Errorf("deleting project selected assets by conversation: %w", err)
		}
		if err := tx.Where("task_id IN (?)", taskIDs).Delete(&domain.GenerationTaskAssetModel{}).Error; err != nil {
			return fmt.Errorf("deleting generation task assets by conversation: %w", err)
		}
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
			query = query.Where("(conversation_id = ? OR conversation_id IS NULL)", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id IS NULL")
	}
	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("counting generation tasks by conversation: %w", err)
	}
	return count, nil
}

// LatestGenerationTaskByConversation returns the most recent task in a conversation.
func (repo *GenerationTaskRepository) LatestGenerationTaskByConversation(kind string, conversationID string, includeLegacyDefault bool) (domain.GenerationTaskModel, error) {
	var model domain.GenerationTaskModel
	query := repo.generationTaskQuery().Order("updated_at DESC")
	trimmedKind := strings.TrimSpace(kind)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedKind != "" {
		query = query.Where("kind = ?", trimmedKind)
	}
	if trimmedConversationID != "" {
		if includeLegacyDefault {
			query = query.Where("(conversation_id = ? OR conversation_id IS NULL)", trimmedConversationID)
		} else {
			query = query.Where("conversation_id = ?", trimmedConversationID)
		}
	} else if trimmedKind != "" {
		query = query.Where("conversation_id IS NULL")
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
			"updated_at": domain.TimeFromString(updatedAt),
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
	id = strings.TrimSpace(id)
	deleted := false
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&domain.GenerationTaskModel{}, "id = ?", id)
		if result.Error != nil {
			return fmt.Errorf("deleting generation task: %w", result.Error)
		}
		deleted = result.RowsAffected > 0
		if !deleted {
			return nil
		}
		if err := tx.Delete(&domain.ProjectSelectedAssetModel{}, "source_task_id = ?", id).Error; err != nil {
			return fmt.Errorf("deleting project selected assets: %w", err)
		}
		if err := tx.Delete(&domain.GenerationTaskAssetModel{}, "task_id = ?", id).Error; err != nil {
			return fmt.Errorf("deleting generation task assets: %w", err)
		}
		if err := tx.Delete(&domain.GenerationTaskAttemptModel{}, "task_id = ?", id).Error; err != nil {
			return fmt.Errorf("deleting generation task attempts: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, err
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

func normalizeGenerationTaskRouteIDs(routeIDs []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(routeIDs))
	for _, routeID := range routeIDs {
		routeID = strings.TrimSpace(routeID)
		if routeID == "" {
			continue
		}
		if _, ok := seen[routeID]; ok {
			continue
		}
		seen[routeID] = struct{}{}
		normalized = append(normalized, routeID)
	}
	return normalized
}

func normalizeGenerationTaskStatus(status string) string {
	return strings.ToLower(strings.TrimSpace(status))
}

// CountGenerationTasksExcludingStatuses counts tasks whose (normalized) status is not
// in the excluded list. Used by the runtime activity probe to detect in-flight work.
func (repo *GenerationTaskRepository) CountGenerationTasksExcludingStatuses(excluded []string) (int64, error) {
	normalized := make([]string, 0, len(excluded))
	for _, status := range excluded {
		normalized = append(normalized, normalizeGenerationTaskStatus(status))
	}
	var count int64
	query := repo.db.Model(&domain.GenerationTaskModel{})
	if len(normalized) > 0 {
		query = query.Where("LOWER(TRIM(status)) NOT IN ?", normalized)
	}
	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("counting active generation tasks: %w", err)
	}
	return count, nil
}
