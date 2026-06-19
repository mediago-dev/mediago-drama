package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GenerationNotificationRepository persists generation notification targets and records.
type GenerationNotificationRepository struct {
	db *gorm.DB
}

// NewGenerationNotificationRepository opens the settings database via the central settings schema owner.
func NewGenerationNotificationRepository(dbPath string) (*GenerationNotificationRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening generation notification repository database: %w", err)
	}
	return NewGenerationNotificationRepositoryFromDB(db), nil
}

// NewGenerationNotificationRepositoryFromDB creates a repository from an existing settings DB.
func NewGenerationNotificationRepositoryFromDB(db *gorm.DB) *GenerationNotificationRepository {
	return &GenerationNotificationRepository{db: db}
}

// UpsertGenerationNotification inserts or updates a notification by task id.
func (repo *GenerationNotificationRepository) UpsertGenerationNotification(model domain.GenerationNotificationModel) error {
	model.ProjectID = domain.CleanProjectID(model.ProjectID)
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "task_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"task_kind",
			"task_status",
			"project_id",
			"title",
			"description",
			"asset_count",
			"target_json",
			"read_at",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting generation notification: %w", err)
	}
	return nil
}

// GetGenerationNotification returns one notification by id.
func (repo *GenerationNotificationRepository) GetGenerationNotification(id string) (domain.GenerationNotificationModel, error) {
	var model domain.GenerationNotificationModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationNotificationModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationNotificationModel{}, fmt.Errorf("getting generation notification: %w", err)
	}
	return model, nil
}

// GetGenerationNotificationByTaskID returns one notification by task id.
func (repo *GenerationNotificationRepository) GetGenerationNotificationByTaskID(taskID string) (domain.GenerationNotificationModel, error) {
	var model domain.GenerationNotificationModel
	err := repo.db.First(&model, "task_id = ?", strings.TrimSpace(taskID)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationNotificationModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationNotificationModel{}, fmt.Errorf("getting generation notification by task id: %w", err)
	}
	return model, nil
}

// ListGenerationNotifications lists completed notifications newest first.
func (repo *GenerationNotificationRepository) ListGenerationNotifications(projectID string, limit int) ([]domain.GenerationNotificationModel, error) {
	models := []domain.GenerationNotificationModel{}
	query := repo.db.
		Where("task_status = ?", "completed").
		Order("updated_at DESC, created_at DESC")
	if cleaned := domain.CleanProjectID(projectID); cleaned != "" {
		query = query.Where("project_id = ?", cleaned)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing generation notifications: %w", err)
	}
	return models, nil
}

// MarkGenerationNotificationRead marks one notification read.
func (repo *GenerationNotificationRepository) MarkGenerationNotificationRead(id string, readAt string) (domain.GenerationNotificationModel, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.GenerationNotificationModel{}, ErrRecordNotFound
	}
	if err := repo.db.Model(&domain.GenerationNotificationModel{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"read_at":    strings.TrimSpace(readAt),
			"updated_at": strings.TrimSpace(readAt),
		}).Error; err != nil {
		return domain.GenerationNotificationModel{}, fmt.Errorf("marking generation notification read: %w", err)
	}
	return repo.GetGenerationNotification(id)
}

// MarkAllGenerationNotificationsRead marks completed notifications read.
func (repo *GenerationNotificationRepository) MarkAllGenerationNotificationsRead(projectID string, readAt string) error {
	query := repo.db.Model(&domain.GenerationNotificationModel{}).
		Where("task_status = ? AND read_at = ?", "completed", "")
	if cleaned := domain.CleanProjectID(projectID); cleaned != "" {
		query = query.Where("project_id = ?", cleaned)
	}
	if err := query.Updates(map[string]any{
		"read_at":    strings.TrimSpace(readAt),
		"updated_at": strings.TrimSpace(readAt),
	}).Error; err != nil {
		return fmt.Errorf("marking generation notifications read: %w", err)
	}
	return nil
}
