// Package repository owns persistent storage access for the CLI server.
package repository

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/glebarez/sqlite"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ErrRecordNotFound is the repository-level not-found sentinel.
var ErrRecordNotFound = gorm.ErrRecordNotFound

var sqliteDBCache sync.Map
var sqliteSchemaMigrationMu sync.Mutex
var workspaceSchemaMigrated sync.Map
var settingsSchemaMigrated sync.Map

// OpenGormSQLite opens a SQLite database with local server pragmas.
func OpenGormSQLite(dbPath string) (*gorm.DB, error) {
	cacheKey, cacheable := sqliteCacheKey(dbPath)
	if cacheable {
		if cached, ok := sqliteDBCache.Load(cacheKey); ok {
			return cached.(*gorm.DB), nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return nil, fmt.Errorf("creating database directory: %w", err)
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("opening sqlite database: %w", err)
	}
	if err := db.Exec("PRAGMA busy_timeout = 5000").Error; err != nil {
		return nil, fmt.Errorf("configuring sqlite busy timeout: %w", err)
	}
	if err := db.Exec("PRAGMA journal_mode = WAL").Error; err != nil {
		return nil, fmt.Errorf("configuring sqlite journal mode: %w", err)
	}
	if err := db.Exec("PRAGMA synchronous = NORMAL").Error; err != nil {
		return nil, fmt.Errorf("configuring sqlite synchronous mode: %w", err)
	}
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		return nil, fmt.Errorf("configuring sqlite foreign keys: %w", err)
	}

	if cacheable {
		actual, loaded := sqliteDBCache.LoadOrStore(cacheKey, db)
		if loaded {
			if sqlDB, err := db.DB(); err == nil {
				_ = sqlDB.Close()
			}
			return actual.(*gorm.DB), nil
		}
	}
	return db, nil
}

func sqliteCacheKey(dbPath string) (string, bool) {
	dbPath = strings.TrimSpace(dbPath)
	if dbPath == "" || strings.Contains(dbPath, ":memory:") {
		return "", false
	}
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return dbPath, true
	}
	return absolute, true
}

// OpenWorkspaceDB opens and migrates the workspace database schema.
func OpenWorkspaceDB(dbPath string) (*gorm.DB, error) {
	db, err := OpenGormSQLite(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening workspace database: %w", err)
	}
	if err := ensureWorkspaceSchemaForPath(dbPath, db); err != nil {
		return nil, fmt.Errorf("ensuring workspace schema: %w", err)
	}
	return db, nil
}

// OpenSettingsDB opens and migrates all settings-backed repository schemas.
func OpenSettingsDB(dbPath string) (*gorm.DB, error) {
	db, err := OpenGormSQLite(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening settings database: %w", err)
	}
	if err := ensureSettingsRepositorySchemasForPath(dbPath, db); err != nil {
		return nil, fmt.Errorf("ensuring settings repository schemas: %w", err)
	}
	return db, nil
}

func ensureWorkspaceSchemaForPath(dbPath string, db *gorm.DB) error {
	return ensureSchemaOnce(dbPath, db, &workspaceSchemaMigrated, EnsureWorkspaceSchema)
}

func ensureSettingsRepositorySchemasForPath(dbPath string, db *gorm.DB) error {
	return ensureSchemaOnce(dbPath, db, &settingsSchemaMigrated, EnsureSettingsRepositorySchemas)
}

func ensureSchemaOnce(
	dbPath string,
	db *gorm.DB,
	migrated *sync.Map,
	ensure func(*gorm.DB) error,
) error {
	cacheKey, cacheable := sqliteCacheKey(dbPath)
	if !cacheable {
		return ensure(db)
	}
	if _, ok := migrated.Load(cacheKey); ok {
		return nil
	}
	sqliteSchemaMigrationMu.Lock()
	defer sqliteSchemaMigrationMu.Unlock()
	if _, ok := migrated.Load(cacheKey); ok {
		return nil
	}
	if err := ensure(db); err != nil {
		return err
	}
	migrated.Store(cacheKey, struct{}{})
	return nil
}

// EnsureWorkspaceSchema creates every project/workspace-owned table.
func EnsureWorkspaceSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&domain.WorkspaceProjectModel{},
		&domain.EpisodeTimelineModel{},
		&domain.DocumentOperationLogModel{},
		&domain.DocumentToolApprovalModel{},
		&domain.AgentSelectionModel{},
		&domain.DocumentEditStreamModel{},
		&domain.DocumentSectionModel{},
		&domain.AgentSessionModel{},
		&domain.AssetModel{},
		&domain.GenerationConversationModel{},
		&domain.GenerationTaskModel{},
		&domain.GenerationTaskAttemptModel{},
		&domain.GenerationTaskReferenceModel{},
		&domain.GenerationTaskAssetModel{},
		&domain.ProjectSelectedAssetModel{},
		&domain.ProjectReferenceAssetModel{},
		&domain.GenerationNotificationModel{},
	); err != nil {
		return fmt.Errorf("initializing workspace database: %w", err)
	}
	return nil
}

// EnsureSettingsSchema creates every global settings table.
func EnsureSettingsSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&domain.APIKeyModel{},
		&domain.AgentModelProfileModel{},
		&domain.PackModel{},
		&domain.PackEntryModel{},
		&domain.PackCategoryModel{},
		&domain.InstructionTemplateModel{},
		&domain.PromptCategoryModel{},
		&domain.PromptLibraryEntryModel{},
		&domain.GenerationPreferenceModel{},
		&domain.AppSettingModel{},
	); err != nil {
		return fmt.Errorf("initializing settings database: %w", err)
	}
	return nil
}

// IsRecordNotFound reports whether err is the repository not-found sentinel.
func IsRecordNotFound(err error) bool {
	return errors.Is(err, ErrRecordNotFound)
}
