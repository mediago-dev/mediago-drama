package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

// MediaAssetRepository persists local media asset metadata.
type MediaAssetRepository struct {
	db *gorm.DB
}

// NewMediaAssetRepository opens the settings database via the central settings schema owner.
func NewMediaAssetRepository(dbPath string) (*MediaAssetRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening media asset repository database: %w", err)
	}
	return NewMediaAssetRepositoryFromDB(db), nil
}

// NewMediaAssetRepositoryFromDB creates a repository from an existing settings DB.
func NewMediaAssetRepositoryFromDB(db *gorm.DB) *MediaAssetRepository {
	return &MediaAssetRepository{db: db}
}

// ListMediaAssets returns recently updated media assets visible to a project.
func (repo *MediaAssetRepository) ListMediaAssets(limit int, projectID string) ([]domain.MediaAssetModel, error) {
	projectID = domain.CleanProjectID(projectID)
	models := []domain.MediaAssetModel{}
	query := repo.db.Order("updated_at DESC").Limit(limit)
	if projectID == "" {
		query = query.Where("project_id = ''")
	} else {
		query = query.Where("project_id = '' OR project_id = ?", projectID)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing media assets: %w", err)
	}
	return models, nil
}

// GetMediaAsset returns a media asset by ID.
func (repo *MediaAssetRepository) GetMediaAsset(id string) (domain.MediaAssetModel, error) {
	var model domain.MediaAssetModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.MediaAssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.MediaAssetModel{}, fmt.Errorf("getting media asset: %w", err)
	}
	return model, nil
}

// FindMediaAssetBySourceURL returns the latest media asset for a source URL.
func (repo *MediaAssetRepository) FindMediaAssetBySourceURL(sourceURL string) (domain.MediaAssetModel, error) {
	var model domain.MediaAssetModel
	err := repo.db.Where("source_url = ?", strings.TrimSpace(sourceURL)).
		Order("updated_at DESC").
		First(&model).Error
	if IsRecordNotFound(err) {
		return domain.MediaAssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.MediaAssetModel{}, fmt.Errorf("finding media asset by source URL: %w", err)
	}
	return model, nil
}

// CreateMediaAsset inserts a media asset.
func (repo *MediaAssetRepository) CreateMediaAsset(model domain.MediaAssetModel) error {
	model.ProjectID = domain.CleanProjectID(model.ProjectID)
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating media asset: %w", err)
	}
	return nil
}

// DeleteMediaAsset deletes a media asset by ID.
func (repo *MediaAssetRepository) DeleteMediaAsset(id string) (bool, error) {
	result := repo.db.Delete(&domain.MediaAssetModel{}, "id = ?", strings.TrimSpace(id))
	if result.Error != nil {
		return false, fmt.Errorf("deleting media asset: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// UpdateMediaAssetFilename updates the display filename and timestamp.
func (repo *MediaAssetRepository) UpdateMediaAssetFilename(id string, filename string, updatedAt string) error {
	err := repo.db.Model(&domain.MediaAssetModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(map[string]any{
			"filename":   strings.TrimSpace(filename),
			"updated_at": updatedAt,
		}).Error
	if err != nil {
		return fmt.Errorf("updating media asset filename: %w", err)
	}
	return nil
}

// UpdateMediaAssetMetadata updates derived media metadata and poster fields.
func (repo *MediaAssetRepository) UpdateMediaAssetMetadata(id string, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	err := repo.db.Model(&domain.MediaAssetModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(updates).Error
	if err != nil {
		return fmt.Errorf("updating media asset metadata: %w", err)
	}
	return nil
}
