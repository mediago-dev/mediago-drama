package repository

import (
	"errors"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

// ProjectAssetRepository persists project-scoped asset metadata.
type ProjectAssetRepository struct {
	db *gorm.DB
}

// NewProjectAssetRepository opens the workspace database for project assets.
func NewProjectAssetRepository(dbPath string) (*ProjectAssetRepository, error) {
	db, err := OpenWorkspaceDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening project asset repository database: %w", err)
	}
	return NewProjectAssetRepositoryFromDB(db), nil
}

// NewProjectAssetRepositoryFromDB creates a repository from an existing workspace DB.
func NewProjectAssetRepositoryFromDB(db *gorm.DB) *ProjectAssetRepository {
	return &ProjectAssetRepository{db: db}
}

// ListProjectAssets returns assets for one project.
func (repo *ProjectAssetRepository) ListProjectAssets(projectID string) ([]domain.ProjectReferenceAssetModel, error) {
	models := []domain.ProjectReferenceAssetModel{}
	if err := repo.db.Preload("Asset").
		Where("project_id = ?", strings.TrimSpace(projectID)).
		Order("sort_order ASC, updated_at DESC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing project assets: %w", err)
	}
	return models, nil
}

// GetProjectAsset returns one project asset by ID.
func (repo *ProjectAssetRepository) GetProjectAsset(projectID string, id string) (domain.ProjectReferenceAssetModel, error) {
	var model domain.ProjectReferenceAssetModel
	err := repo.db.Preload("Asset").First(
		&model,
		"project_id = ? AND id = ?",
		strings.TrimSpace(projectID),
		strings.TrimSpace(id),
	).Error
	if IsRecordNotFound(err) {
		return domain.ProjectReferenceAssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.ProjectReferenceAssetModel{}, fmt.Errorf("getting project asset: %w", err)
	}
	return model, nil
}

// CreateProjectAsset inserts one project asset.
func (repo *ProjectAssetRepository) CreateProjectAsset(model domain.ProjectReferenceAssetModel) error {
	return repo.db.Transaction(func(tx *gorm.DB) error {
		if strings.TrimSpace(model.Asset.ID) != "" {
			model.Asset.ProjectID = domain.StringPtr(model.ProjectID)
			if err := tx.Create(&model.Asset).Error; err != nil {
				return fmt.Errorf("creating project reference asset file: %w", err)
			}
			if strings.TrimSpace(model.AssetID) == "" {
				model.AssetID = model.Asset.ID
			}
		}
		if err := tx.Create(&model).Error; err != nil {
			return fmt.Errorf("creating project asset: %w", err)
		}
		return nil
	})
}

// UpdateProjectAsset updates project asset mutable fields.
func (repo *ProjectAssetRepository) UpdateProjectAsset(projectID string, id string, updates map[string]any) (bool, error) {
	if len(updates) == 0 {
		return true, nil
	}
	projectUpdates := map[string]any{}
	assetUpdates := map[string]any{}
	for key, value := range updates {
		if key == "updated_at" {
			if text, ok := value.(string); ok {
				value = domain.TimeFromString(text)
			}
		}
		switch key {
		case "filename", "kind", "mime_type", "size_bytes", "rel_path", "url", "updated_at":
			assetUpdates[key] = value
		case "path":
			assetUpdates["rel_path"] = value
		default:
			projectUpdates[key] = value
		}
	}

	updated := false
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		var model domain.ProjectReferenceAssetModel
		err := tx.First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(id)).Error
		if IsRecordNotFound(err) {
			return ErrRecordNotFound
		}
		if err != nil {
			return fmt.Errorf("reading project asset: %w", err)
		}
		if len(assetUpdates) > 0 {
			result := tx.Model(&domain.AssetModel{}).Where("id = ?", model.AssetID).Updates(assetUpdates)
			if result.Error != nil {
				return fmt.Errorf("updating project asset file: %w", result.Error)
			}
			updated = updated || result.RowsAffected > 0
		}
		if len(projectUpdates) > 0 {
			result := tx.Model(&domain.ProjectReferenceAssetModel{}).
				Where("project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(id)).
				Updates(projectUpdates)
			if result.Error != nil {
				return fmt.Errorf("updating project asset: %w", result.Error)
			}
			updated = updated || result.RowsAffected > 0
		}
		return nil
	})
	if errors.Is(err, ErrRecordNotFound) {
		return false, nil
	}
	return updated, err
}

// DeleteProjectAssets deletes assets by IDs for one project.
func (repo *ProjectAssetRepository) DeleteProjectAssets(projectID string, ids []string) (int64, error) {
	cleanIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			cleanIDs = append(cleanIDs, id)
		}
	}
	if len(cleanIDs) == 0 {
		return 0, nil
	}
	projectID = strings.TrimSpace(projectID)
	var deleted int64
	if err := repo.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&domain.ProjectReferenceAssetModel{}, "project_id = ? AND id IN ?", projectID, cleanIDs)
		if result.Error != nil {
			return fmt.Errorf("deleting project assets: %w", result.Error)
		}
		deleted = result.RowsAffected
		return nil
	}); err != nil {
		return 0, err
	}
	return deleted, nil
}
