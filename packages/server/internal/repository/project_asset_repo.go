package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
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
func (repo *ProjectAssetRepository) ListProjectAssets(projectID string) ([]domain.ProjectAssetModel, error) {
	models := []domain.ProjectAssetModel{}
	if err := repo.db.Where("project_id = ?", strings.TrimSpace(projectID)).
		Order("sort_order ASC, updated_at DESC, filename ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing project assets: %w", err)
	}
	return models, nil
}

// GetProjectAsset returns one project asset by ID.
func (repo *ProjectAssetRepository) GetProjectAsset(projectID string, id string) (domain.ProjectAssetModel, error) {
	var model domain.ProjectAssetModel
	err := repo.db.First(
		&model,
		"project_id = ? AND id = ?",
		strings.TrimSpace(projectID),
		strings.TrimSpace(id),
	).Error
	if IsRecordNotFound(err) {
		return domain.ProjectAssetModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.ProjectAssetModel{}, fmt.Errorf("getting project asset: %w", err)
	}
	return model, nil
}

// CreateProjectAsset inserts one project asset.
func (repo *ProjectAssetRepository) CreateProjectAsset(model domain.ProjectAssetModel) error {
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating project asset: %w", err)
	}
	return nil
}

// UpdateProjectAsset updates project asset mutable fields.
func (repo *ProjectAssetRepository) UpdateProjectAsset(projectID string, id string, updates map[string]any) (bool, error) {
	if len(updates) == 0 {
		return true, nil
	}
	result := repo.db.Model(&domain.ProjectAssetModel{}).
		Where("project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(id)).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("updating project asset: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
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
		result := tx.Delete(&domain.ProjectAssetModel{}, "project_id = ? AND id IN ?", projectID, cleanIDs)
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
