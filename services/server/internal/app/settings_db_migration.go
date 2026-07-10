package app

import (
	"fmt"
	"path/filepath"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func migrateDefaultSettingsDB(settingsDB *gorm.DB, legacyDBPath string, settingsDBPath string) error {
	if settingsDB == nil || sameDatabasePath(legacyDBPath, settingsDBPath) {
		return nil
	}

	legacyDB, err := repository.OpenGormSQLite(legacyDBPath)
	if err != nil {
		return fmt.Errorf("opening legacy workspace settings database %q: %w", legacyDBPath, err)
	}
	if err := migrateLegacySettingsRows(legacyDB, settingsDB); err != nil {
		return fmt.Errorf("migrating legacy workspace settings from %q: %w", legacyDBPath, err)
	}
	return nil
}

func sameDatabasePath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil && rightErr == nil {
		return filepath.Clean(leftAbs) == filepath.Clean(rightAbs)
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

func migrateLegacySettingsRows(source *gorm.DB, target *gorm.DB) error {
	if err := migrateLegacySettingsModel[domain.APIKeyModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.AgentModelProfileModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.PackModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.PackEntryModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.PackCategoryModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.InstructionTemplateModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.PromptCategoryModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.PromptLibraryEntryModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.GenerationPreferenceModel](source, target); err != nil {
		return err
	}
	if err := migrateLegacySettingsModel[domain.AppSettingModel](source, target); err != nil {
		return err
	}
	return nil
}

func migrateLegacySettingsModel[T any](source *gorm.DB, target *gorm.DB) error {
	var model T
	if !source.Migrator().HasTable(&model) {
		return nil
	}

	var rows []T
	if err := source.Find(&rows).Error; err != nil {
		return fmt.Errorf("reading legacy settings rows for %T: %w", model, err)
	}
	if len(rows) == 0 {
		return nil
	}
	if err := target.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
		return fmt.Errorf("writing settings rows for %T: %w", model, err)
	}
	return nil
}
