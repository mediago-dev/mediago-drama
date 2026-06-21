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

// NewMediaAssetRepository opens the workspace database via the central workspace schema owner.
func NewMediaAssetRepository(dbPath string) (*MediaAssetRepository, error) {
	db, err := OpenWorkspaceDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening media asset repository database: %w", err)
	}
	return NewMediaAssetRepositoryFromDB(db), nil
}

// NewMediaAssetRepositoryFromDB creates a repository from an existing workspace DB.
func NewMediaAssetRepositoryFromDB(db *gorm.DB) *MediaAssetRepository {
	return &MediaAssetRepository{db: db}
}

// ListMediaAssets returns recently updated media assets visible to a project.
func (repo *MediaAssetRepository) ListMediaAssets(limit int, projectID string) ([]domain.AssetModel, error) {
	projectID = domain.CleanProjectID(projectID)
	models := []domain.AssetModel{}
	query := repo.db.Order("updated_at DESC").Limit(limit)
	if projectID == "" {
		query = query.Where("project_id IS NULL")
	} else {
		query = query.Where("project_id IS NULL OR project_id = ?", projectID)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing media assets: %w", err)
	}
	return models, nil
}

// ListAllMediaAssets returns every media asset ordered by update time.
func (repo *MediaAssetRepository) ListAllMediaAssets() ([]domain.AssetModel, error) {
	models := []domain.AssetModel{}
	if err := repo.db.Order("updated_at DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing all media assets: %w", err)
	}
	return models, nil
}

// GetMediaAsset returns a media asset by ID.
func (repo *MediaAssetRepository) GetMediaAsset(id string) (domain.AssetModel, error) {
	var model domain.AssetModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.AssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AssetModel{}, fmt.Errorf("getting media asset: %w", err)
	}
	return model, nil
}

// FindMediaAssetBySourceURL returns the latest media asset for a source URL.
func (repo *MediaAssetRepository) FindMediaAssetBySourceURL(sourceURL string) (domain.AssetModel, error) {
	var model domain.AssetModel
	err := repo.db.Where("source_url = ?", strings.TrimSpace(sourceURL)).
		Order("updated_at DESC").
		First(&model).Error
	if IsRecordNotFound(err) {
		return domain.AssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AssetModel{}, fmt.Errorf("finding media asset by source URL: %w", err)
	}
	return model, nil
}

// FindMediaAssetBySourceURLAndScope returns the latest media asset for a source URL in one generation scope.
func (repo *MediaAssetRepository) FindMediaAssetBySourceURLAndScope(sourceURL string, projectID string, source string, conversationID string) (domain.AssetModel, error) {
	var model domain.AssetModel
	err := repo.db.Where(
		"source_url = ? AND COALESCE(project_id, '') = ? AND source = ?",
		strings.TrimSpace(sourceURL),
		domain.CleanProjectID(projectID),
		strings.TrimSpace(source),
	).
		Order("updated_at DESC").
		First(&model).Error
	if IsRecordNotFound(err) {
		return domain.AssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AssetModel{}, fmt.Errorf("finding media asset by source URL and scope: %w", err)
	}
	return model, nil
}

// FindMediaAssetByContentHashAndScope returns the latest generated asset with identical content in one generation scope.
func (repo *MediaAssetRepository) FindMediaAssetByContentHashAndScope(contentHash string, kind string, projectID string, source string, conversationID string) (domain.AssetModel, error) {
	var model domain.AssetModel
	err := repo.db.Where(
		"content_hash = ? AND kind = ? AND COALESCE(project_id, '') = ? AND source = ?",
		strings.TrimSpace(contentHash),
		strings.TrimSpace(kind),
		domain.CleanProjectID(projectID),
		strings.TrimSpace(source),
	).
		Order("updated_at DESC").
		First(&model).Error
	if IsRecordNotFound(err) {
		return domain.AssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AssetModel{}, fmt.Errorf("finding media asset by content hash and scope: %w", err)
	}
	return model, nil
}

// CreateMediaAsset inserts a media asset.
func (repo *MediaAssetRepository) CreateMediaAsset(model domain.AssetModel) error {
	model.ProjectID = domain.StringPtr(domain.CleanProjectID(domain.StringValue(model.ProjectID)))
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating media asset: %w", err)
	}
	return nil
}

// DeleteMediaAsset deletes a media asset by ID.
func (repo *MediaAssetRepository) DeleteMediaAsset(id string) (bool, error) {
	result := repo.db.Delete(&domain.AssetModel{}, "id = ?", strings.TrimSpace(id))
	if result.Error != nil {
		return false, fmt.Errorf("deleting media asset: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// UpdateMediaAssetFilename updates the display filename and timestamp.
func (repo *MediaAssetRepository) UpdateMediaAssetFilename(id string, filename string, updatedAt string) error {
	err := repo.db.Model(&domain.AssetModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(map[string]any{
			"filename":   strings.TrimSpace(filename),
			"updated_at": domain.TimeFromString(updatedAt),
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
	err := repo.db.Model(&domain.AssetModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(updates).Error
	if err != nil {
		return fmt.Errorf("updating media asset metadata: %w", err)
	}
	return nil
}

// UpdateMediaAssetStorage updates the physical storage metadata for an asset.
func (repo *MediaAssetRepository) UpdateMediaAssetStorage(id string, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	err := repo.db.Model(&domain.AssetModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Updates(updates).Error
	if err != nil {
		return fmt.Errorf("updating media asset storage: %w", err)
	}
	return nil
}
