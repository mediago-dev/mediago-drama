package repository

import (
	"fmt"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PromptLibraryRepository persists reusable generation prompts.
type PromptLibraryRepository struct {
	db *gorm.DB
}

// NewPromptLibraryRepository opens the settings database via the central settings schema owner.
func NewPromptLibraryRepository(dbPath string) (*PromptLibraryRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening prompt library repository database: %w", err)
	}
	return NewPromptLibraryRepositoryFromDB(db), nil
}

// NewPromptLibraryRepositoryFromDB creates a repository from an existing settings DB.
func NewPromptLibraryRepositoryFromDB(db *gorm.DB) *PromptLibraryRepository {
	return &PromptLibraryRepository{db: db}
}

// ListPromptLibraryEntries returns all reusable generation prompts.
func (repo *PromptLibraryRepository) ListPromptLibraryEntries() ([]domain.PromptLibraryEntryModel, error) {
	models := []domain.PromptLibraryEntryModel{}
	if err := repo.db.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing prompt library entries: %w", err)
	}
	return models, nil
}

// GetPromptLibraryEntry returns one reusable generation prompt by ID.
func (repo *PromptLibraryRepository) GetPromptLibraryEntry(id string) (domain.PromptLibraryEntryModel, error) {
	var model domain.PromptLibraryEntryModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.PromptLibraryEntryModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.PromptLibraryEntryModel{}, fmt.Errorf("getting prompt library entry: %w", err)
	}
	return model, nil
}

// UpsertPromptLibraryEntry inserts or updates one reusable generation prompt.
func (repo *PromptLibraryRepository) UpsertPromptLibraryEntry(model domain.PromptLibraryEntryModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"layer",
			"type",
			"kind",
			"category",
			"prompt",
			"source",
			"builtin",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting prompt library entry: %w", err)
	}
	return nil
}

// DeletePromptLibraryEntry removes one reusable generation prompt.
func (repo *PromptLibraryRepository) DeletePromptLibraryEntry(id string) error {
	err := repo.db.Delete(&domain.PromptLibraryEntryModel{}, "id = ?", strings.TrimSpace(id)).Error
	if err != nil {
		return fmt.Errorf("deleting prompt library entry: %w", err)
	}
	return nil
}
