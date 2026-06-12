package repository

import (
	"fmt"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AgentModelProfileRepository persists global ACP model profiles.
type AgentModelProfileRepository struct {
	db *gorm.DB
}

// NewAgentModelProfileRepository opens the settings database via the central settings schema owner.
func NewAgentModelProfileRepository(dbPath string) (*AgentModelProfileRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening agent model profile repository database: %w", err)
	}
	return NewAgentModelProfileRepositoryFromDB(db), nil
}

// NewAgentModelProfileRepositoryFromDB creates a repository from an existing settings DB.
func NewAgentModelProfileRepositoryFromDB(db *gorm.DB) *AgentModelProfileRepository {
	return &AgentModelProfileRepository{db: db}
}

// ListAgentModelProfiles returns all global ACP model profiles.
func (repo *AgentModelProfileRepository) ListAgentModelProfiles() ([]domain.AgentModelProfileModel, error) {
	models := []domain.AgentModelProfileModel{}
	if err := repo.db.Order("is_default DESC, name ASC, id ASC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing agent model profiles: %w", err)
	}
	return models, nil
}

// GetAgentModelProfile returns one global ACP model profile by id.
func (repo *AgentModelProfileRepository) GetAgentModelProfile(id string) (domain.AgentModelProfileModel, error) {
	var model domain.AgentModelProfileModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.AgentModelProfileModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentModelProfileModel{}, fmt.Errorf("getting agent model profile: %w", err)
	}
	return model, nil
}

// UpsertAgentModelProfile inserts or updates one global ACP model profile.
func (repo *AgentModelProfileRepository) UpsertAgentModelProfile(model domain.AgentModelProfileModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"provider_id",
			"provider_label",
			"base_url",
			"model",
			"model_display_name",
			"enabled",
			"is_default",
			"supports_images",
			"supports_tools",
			"context_window",
			"max_output_tokens",
			"temperature",
			"api_key_name",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting agent model profile: %w", err)
	}
	return nil
}

// DeleteAgentModelProfile removes one global ACP model profile.
func (repo *AgentModelProfileRepository) DeleteAgentModelProfile(id string) (bool, error) {
	result := repo.db.Delete(&domain.AgentModelProfileModel{}, "id = ?", strings.TrimSpace(id))
	if result.Error != nil {
		return false, fmt.Errorf("deleting agent model profile: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// ClearAgentModelProfileDefaults clears the default flag for every model profile.
func (repo *AgentModelProfileRepository) ClearAgentModelProfileDefaults() error {
	if err := repo.db.Model(&domain.AgentModelProfileModel{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
		return fmt.Errorf("clearing agent model profile defaults: %w", err)
	}
	return nil
}

// SetAgentModelProfileDefault makes one profile the global default.
func (repo *AgentModelProfileRepository) SetAgentModelProfileDefault(id string) error {
	id = strings.TrimSpace(id)
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&domain.AgentModelProfileModel{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
			return err
		}
		result := tx.Model(&domain.AgentModelProfileModel{}).Where("id = ?", id).Update("is_default", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRecordNotFound
		}
		return nil
	})
	if IsRecordNotFound(err) {
		return ErrRecordNotFound
	}
	if err != nil {
		return fmt.Errorf("setting agent model profile default: %w", err)
	}
	return nil
}
