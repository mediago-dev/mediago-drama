package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InstructionTemplateRepository persists user overrides for official instruction templates.
type InstructionTemplateRepository struct {
	db *gorm.DB
}

// NewInstructionTemplateRepositoryFromDB creates a repository from an existing settings DB.
func NewInstructionTemplateRepositoryFromDB(db *gorm.DB) *InstructionTemplateRepository {
	return &InstructionTemplateRepository{db: db}
}

// List returns every saved instruction template override.
func (repo *InstructionTemplateRepository) List(ctx context.Context) ([]domain.InstructionTemplateModel, error) {
	models := []domain.InstructionTemplateModel{}
	if err := repo.db.WithContext(ctx).Order("id asc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing instruction template overrides: %w", err)
	}
	return models, nil
}

// Get returns one saved instruction template override by ID.
func (repo *InstructionTemplateRepository) Get(ctx context.Context, id string) (domain.InstructionTemplateModel, error) {
	var model domain.InstructionTemplateModel
	err := repo.db.WithContext(ctx).First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.InstructionTemplateModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.InstructionTemplateModel{}, fmt.Errorf("getting instruction template override: %w", err)
	}
	return model, nil
}

// Upsert inserts or updates one instruction template override.
func (repo *InstructionTemplateRepository) Upsert(ctx context.Context, model domain.InstructionTemplateModel) error {
	err := repo.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"content",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting instruction template override: %w", err)
	}
	return nil
}

// Delete removes one instruction template override.
func (repo *InstructionTemplateRepository) Delete(ctx context.Context, id string) error {
	err := repo.db.WithContext(ctx).
		Delete(&domain.InstructionTemplateModel{}, "id = ?", strings.TrimSpace(id)).
		Error
	if err != nil {
		return fmt.Errorf("deleting instruction template override: %w", err)
	}
	return nil
}
