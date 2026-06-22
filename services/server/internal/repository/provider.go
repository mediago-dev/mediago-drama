package repository

import (
	"fmt"

	"gorm.io/gorm"
)

// WorkspaceRepositories groups repositories backed by the workspace database.
type WorkspaceRepositories struct {
	DB                      *gorm.DB
	Workspace               *WorkspaceRepository
	EditStreams             *DocumentEditStreamRepository
	AgentSessions           *AgentSessionRepository
	Approvals               *DocumentToolApprovalRepository
	DocumentSections        *DocumentSectionRepository
	Billing                 *BillingRepository
	GenerationNotifications *GenerationNotificationRepository
	GenerationTasks         *GenerationTaskRepository
	MediaAssets             *MediaAssetRepository
	ProjectAssets           *ProjectAssetRepository
}

// OpenWorkspaceRepositories opens the workspace DB, runs the workspace
// migration owner, and builds all repositories backed by that DB.
func OpenWorkspaceRepositories(dbPath string) (WorkspaceRepositories, error) {
	db, err := OpenWorkspaceDB(dbPath)
	if err != nil {
		return WorkspaceRepositories{}, err
	}
	return WorkspaceRepositories{
		DB:                      db,
		Workspace:               NewWorkspaceRepository(db),
		EditStreams:             NewDocumentEditStreamRepository(db),
		AgentSessions:           NewAgentSessionRepository(db),
		Approvals:               NewDocumentToolApprovalRepository(db),
		DocumentSections:        NewDocumentSectionRepositoryFromDB(db),
		Billing:                 NewBillingRepositoryFromDB(db),
		GenerationNotifications: NewGenerationNotificationRepositoryFromDB(db),
		GenerationTasks:         NewGenerationTaskRepositoryFromDB(db),
		MediaAssets:             NewMediaAssetRepositoryFromDB(db),
		ProjectAssets:           NewProjectAssetRepositoryFromDB(db),
	}, nil
}

// SettingsRepositories groups repositories backed by the settings database.
type SettingsRepositories struct {
	DB                    *gorm.DB
	APIKeys               *APIKeyStore
	AgentModelProfiles    *AgentModelProfileRepository
	GenerationPreferences *GenerationPreferenceRepository
	Instructions          *InstructionTemplateRepository
	Packs                 *PackRepository
	PromptLibrary         *PromptLibraryRepository
}

// EnsureSettingsRepositorySchemas migrates all tables stored in the settings
// database. This is the central owner for settings-backed repository schemas.
func EnsureSettingsRepositorySchemas(db *gorm.DB) error {
	if err := EnsureSettingsSchema(db); err != nil {
		return err
	}
	return nil
}

// OpenSettingsRepositories opens the settings DB, runs all settings-backed
// migrations once, and builds repositories sharing that DB connection.
func OpenSettingsRepositories(dbPath string) (SettingsRepositories, error) {
	db, err := OpenGormSQLite(dbPath)
	if err != nil {
		wrapped := fmt.Errorf("opening settings database: %w", err)
		return SettingsRepositories{APIKeys: NewAPIKeyStoreFromDB(nil, wrapped)}, wrapped
	}
	if err := ensureSettingsRepositorySchemasForPath(dbPath, db); err != nil {
		wrapped := fmt.Errorf("ensuring settings repository schemas: %w", err)
		return SettingsRepositories{DB: db, APIKeys: NewAPIKeyStoreFromDB(db, wrapped)}, wrapped
	}
	return SettingsRepositories{
		DB:                    db,
		APIKeys:               NewAPIKeyStoreFromDB(db, nil),
		AgentModelProfiles:    NewAgentModelProfileRepositoryFromDB(db),
		GenerationPreferences: NewGenerationPreferenceRepositoryFromDB(db),
		Instructions:          NewInstructionTemplateRepositoryFromDB(db),
		Packs:                 NewPackRepositoryFromDB(db),
		PromptLibrary:         NewPromptLibraryRepositoryFromDB(db),
	}, nil
}
