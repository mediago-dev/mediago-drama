package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GenerationPreferenceRepository persists generation preferences by scope.
type GenerationPreferenceRepository struct {
	db *gorm.DB
}

// NewGenerationPreferenceRepository opens the settings database via the central settings schema owner.
func NewGenerationPreferenceRepository(dbPath string) (*GenerationPreferenceRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening generation preference repository database: %w", err)
	}
	return NewGenerationPreferenceRepositoryFromDB(db), nil
}

// NewGenerationPreferenceRepositoryFromDB creates a repository from an existing settings DB.
func NewGenerationPreferenceRepositoryFromDB(db *gorm.DB) *GenerationPreferenceRepository {
	return &GenerationPreferenceRepository{db: db}
}

// GetGenerationPreference returns generation preferences for one scope.
func (repo *GenerationPreferenceRepository) GetGenerationPreference(scopeID string) (domain.GenerationPreferenceModel, error) {
	var model domain.GenerationPreferenceModel
	err := repo.db.First(&model, "scope_id = ?", strings.TrimSpace(scopeID)).Error
	if IsRecordNotFound(err) {
		return domain.GenerationPreferenceModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.GenerationPreferenceModel{}, fmt.Errorf("getting generation preference: %w", err)
	}
	return model, nil
}

// UpsertGenerationPreference inserts or updates generation preferences.
func (repo *GenerationPreferenceRepository) UpsertGenerationPreference(model domain.GenerationPreferenceModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "scope_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"family_ids_json",
			"route_ids_json",
			"version_ids_json",
			"route_params_json",
			"style_preset_id",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting generation preference: %w", err)
	}
	return nil
}
