package repository

import (
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AppSettingRepository persists non-secret app settings in the settings database.
type AppSettingRepository struct {
	db *gorm.DB
}

// NewAppSettingRepository opens the settings database via the central settings schema owner.
func NewAppSettingRepository(dbPath string) (*AppSettingRepository, error) {
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening app setting repository database: %w", err)
	}
	return NewAppSettingRepositoryFromDB(db), nil
}

// NewAppSettingRepositoryFromDB creates a repository from an existing settings DB.
func NewAppSettingRepositoryFromDB(db *gorm.DB) *AppSettingRepository {
	return &AppSettingRepository{db: db}
}

// GetAppSetting returns a setting value by key.
func (repo *AppSettingRepository) GetAppSetting(key string) (string, bool, error) {
	var model domain.AppSettingModel
	err := repo.db.First(&model, "setting_key = ?", strings.TrimSpace(key)).Error
	if IsRecordNotFound(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("getting app setting: %w", err)
	}
	return model.Value, true, nil
}

// SetAppSetting upserts a setting value by key.
func (repo *AppSettingRepository) SetAppSetting(key string, value string) error {
	model := domain.AppSettingModel{
		Key:       strings.TrimSpace(key),
		Value:     strings.TrimSpace(value),
		UpdatedAt: time.Now().UTC(),
	}
	return repo.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "setting_key"}},
		DoUpdates: clause.AssignmentColumns([]string{"setting_value", "updated_at"}),
	}).Create(&model).Error
}

// ClearAppSetting removes a setting value by key.
func (repo *AppSettingRepository) ClearAppSetting(key string) error {
	if err := repo.db.Delete(&domain.AppSettingModel{}, "setting_key = ?", strings.TrimSpace(key)).Error; err != nil {
		return fmt.Errorf("clearing app setting: %w", err)
	}
	return nil
}
