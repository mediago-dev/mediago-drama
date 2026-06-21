// Package repository owns persistent storage access for the CLI server.
package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/glebarez/sqlite"
	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// ErrRecordNotFound is the repository-level not-found sentinel.
var ErrRecordNotFound = gorm.ErrRecordNotFound

var sqliteDBCache sync.Map
var sqliteSchemaMigrationMu sync.Mutex
var workspaceSchemaMigrated sync.Map
var settingsSchemaMigrated sync.Map

const (
	workspaceDropDeprecatedStorageMigrationKey = "workspace.drop_deprecated_storage.v1"
	agentModelProfileMiniMaxMigrationKey       = "settings.agent_model_profiles.minimax_domestic_endpoint.v1"
	mediaAssetLibraryTableMigrationKey         = "settings.media_assets.rename_to_library_assets.v1"
	generationTaskProviderBackfillMigrationKey = "settings.generation_tasks.backfill_official_providers.v1"
	generationTaskStatusNormalizeMigrationKey  = "settings.generation_tasks.normalize_status.v1"
	generationTaskAssetsBackfillMigrationKey   = "settings.generation_task_assets.backfill.v1"
	projectSelectedAssetsBackfillMigrationKey  = "settings.project_selected_assets.backfill.v1"
	promptLibraryCategoryMigrationKey          = "settings.prompt_library_entries.layer_to_category.v1"
	promptLibraryDropKindMigrationKey          = "settings.prompt_library_entries.drop_kind.v1"
)

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

// EnsureWorkspaceSchema migrates all tables stored in the workspace database.
func EnsureWorkspaceSchema(db *gorm.DB) error {
	if err := runSchemaMigrationOnce(
		db,
		workspaceDropDeprecatedStorageMigrationKey,
		dropDeprecatedWorkspaceStorage,
	); err != nil {
		return err
	}
	if err := db.AutoMigrate(
		&domain.WorkspaceProjectModel{},
		&domain.EpisodeTimelineModel{},
		&domain.DocumentOperationLogModel{},
		&domain.DocumentToolApprovalModel{},
		&domain.AgentSessionModel{},
		&domain.DocumentEditStreamModel{},
		&domain.ProjectAssetModel{},
	); err != nil {
		return fmt.Errorf("initializing workspace database: %w", err)
	}
	return nil
}

func dropDeprecatedWorkspaceStorage(db *gorm.DB) error {
	for _, table := range []string{"documents", "document_folders", "asset_folders"} {
		if db.Migrator().HasTable(table) {
			if err := db.Migrator().DropTable(table); err != nil {
				return fmt.Errorf("dropping deprecated %s table: %w", table, err)
			}
		}
	}
	if db.Migrator().HasTable("projects") && sqliteColumnExists(db, "projects", "document_count") {
		if err := db.Exec("ALTER TABLE projects DROP COLUMN document_count").Error; err != nil {
			return fmt.Errorf("dropping deprecated projects.document_count column: %w", err)
		}
	}
	return nil
}

type sqliteColumnInfo struct {
	Name string `gorm:"column:name"`
}

func sqliteColumnExists(db *gorm.DB, table string, column string) bool {
	columns := []sqliteColumnInfo{}
	if err := db.Raw("PRAGMA table_info(" + table + ")").Scan(&columns).Error; err != nil {
		return false
	}
	for _, info := range columns {
		if strings.EqualFold(info.Name, column) {
			return true
		}
	}
	return false
}

type schemaMigrationRecord struct {
	Key       string `gorm:"column:key;primaryKey"`
	AppliedAt string `gorm:"column:applied_at;not null"`
}

func (schemaMigrationRecord) TableName() string {
	return "schema_migrations"
}

func runSchemaMigrationOnce(db *gorm.DB, key string, migrate func(*gorm.DB) error) error {
	if err := db.AutoMigrate(&schemaMigrationRecord{}); err != nil {
		return fmt.Errorf("initializing schema migrations table: %w", err)
	}

	var count int64
	if err := db.Model(&schemaMigrationRecord{}).Where("key = ?", key).Count(&count).Error; err != nil {
		return fmt.Errorf("checking schema migration %q: %w", key, err)
	}
	if count > 0 {
		return nil
	}

	if err := migrate(db); err != nil {
		return err
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&schemaMigrationRecord{
		Key:       key,
		AppliedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}).Error; err != nil {
		return fmt.Errorf("recording schema migration %q: %w", key, err)
	}
	return nil
}

// EnsureSettingsSchema migrates tables shared by settings-backed stores.
func EnsureSettingsSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.APIKeyModel{}); err != nil {
		return fmt.Errorf("initializing settings database: %w", err)
	}
	return nil
}

// EnsureAgentModelProfileSchema migrates global ACP model profile tables.
func EnsureAgentModelProfileSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.AgentModelProfileModel{}); err != nil {
		return fmt.Errorf("initializing agent model profile database: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		agentModelProfileMiniMaxMigrationKey,
		migrateMiniMaxAgentProfileToDomesticEndpoint,
	); err != nil {
		return err
	}
	return nil
}

func migrateMiniMaxAgentProfileToDomesticEndpoint(db *gorm.DB) error {
	result := db.Model(&domain.AgentModelProfileModel{}).
		Where("id = ? AND provider_id = ? AND base_url IN ?", "minimax", "minimax", []string{
			"https://api.minimax.io/v1",
			"https://api.minimaxi.com/v1",
		}).
		Updates(map[string]any{
			"base_url": "https://api.minimaxi.com/v1",
			"name": gorm.Expr(
				"CASE WHEN name = ? THEN ? ELSE name END",
				"MiniMax",
				"MiniMax 国内",
			),
			"provider_label": gorm.Expr(
				"CASE WHEN provider_label = ? THEN ? ELSE provider_label END",
				"MiniMax",
				"MiniMax 国内",
			),
		})
	if result.Error != nil {
		return fmt.Errorf("migrating minimax agent model profile endpoint: %w", result.Error)
	}
	var existingMiniMaxCN int64
	if err := db.Model(&domain.AgentModelProfileModel{}).
		Where("provider_id = ? AND id <> ?", "minimax-cn", "minimax").
		Count(&existingMiniMaxCN).Error; err != nil {
		return fmt.Errorf("checking minimax-cn agent model profile: %w", err)
	}
	if existingMiniMaxCN == 0 {
		result = db.Model(&domain.AgentModelProfileModel{}).
			Where("id = ? AND provider_id = ? AND base_url = ?", "minimax", "minimax", "https://api.minimaxi.com/v1").
			Update("provider_id", "minimax-cn")
		if result.Error != nil {
			return fmt.Errorf("migrating minimax agent model profile provider id: %w", result.Error)
		}
	}
	return nil
}

// EnsureMediaAssetSchema migrates media asset tables.
func EnsureMediaAssetSchema(db *gorm.DB) error {
	if err := runSchemaMigrationOnce(
		db,
		mediaAssetLibraryTableMigrationKey,
		renameMediaAssetsToLibraryAssets,
	); err != nil {
		return fmt.Errorf("migrating media assets table to library assets: %w", err)
	}
	if err := db.AutoMigrate(&domain.MediaAssetModel{}); err != nil {
		return fmt.Errorf("initializing media asset database: %w", err)
	}
	return nil
}

func renameMediaAssetsToLibraryAssets(db *gorm.DB) error {
	migrator := db.Migrator()
	if migrator.HasTable("media_assets") && !migrator.HasTable("library_assets") {
		if err := db.Exec("ALTER TABLE media_assets RENAME TO library_assets").Error; err != nil {
			return fmt.Errorf("renaming media_assets table: %w", err)
		}
	}
	for _, indexName := range []string{
		"media_assets_source_url_idx",
		"media_assets_project_id_idx",
		"media_assets_source_idx",
		"media_assets_conversation_id_idx",
		"media_assets_section_id_idx",
	} {
		if err := db.Exec("DROP INDEX IF EXISTS " + indexName).Error; err != nil {
			return fmt.Errorf("dropping legacy media asset index %s: %w", indexName, err)
		}
	}
	return nil
}

// EnsureGenerationTaskSchema migrates generation task tables.
func EnsureGenerationTaskSchema(db *gorm.DB) error {
	if err := renameGenerationTaskProviderColumn(db); err != nil {
		return fmt.Errorf("renaming generation task provider column: %w", err)
	}
	if err := db.AutoMigrate(
		&domain.GenerationConversationModel{},
		&domain.GenerationTaskModel{},
		&domain.GenerationTaskAttemptModel{},
		&domain.GenerationTaskAssetModel{},
		&domain.ProjectResourceAssetModel{},
		&domain.ProjectSelectedAssetModel{},
	); err != nil {
		return fmt.Errorf("initializing generation task database: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		generationTaskProviderBackfillMigrationKey,
		backfillOfficialGenerationTaskProviders,
	); err != nil {
		return fmt.Errorf("backfilling generation task providers: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		generationTaskStatusNormalizeMigrationKey,
		normalizePersistedGenerationTaskStatuses,
	); err != nil {
		return fmt.Errorf("normalizing generation task statuses: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		generationTaskAssetsBackfillMigrationKey,
		backfillNormalizedGenerationAssetRows,
	); err != nil {
		return fmt.Errorf("backfilling normalized generation asset rows: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		projectSelectedAssetsBackfillMigrationKey,
		backfillProjectSelectedAssetRows,
	); err != nil {
		return fmt.Errorf("backfilling project selected asset rows: %w", err)
	}
	return nil
}

// EnsureGenerationPreferenceSchema migrates generation preference tables.
func EnsureGenerationPreferenceSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.GenerationPreferenceModel{}); err != nil {
		return fmt.Errorf("initializing generation preference database: %w", err)
	}
	return nil
}

// EnsureGenerationNotificationSchema migrates generation notification tables.
func EnsureGenerationNotificationSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.GenerationNotificationModel{}); err != nil {
		return fmt.Errorf("initializing generation notification database: %w", err)
	}
	return nil
}

// EnsurePromptLibrarySchema migrates prompt library tables.
func EnsurePromptLibrarySchema(db *gorm.DB) error {
	if err := runSchemaMigrationOnce(
		db,
		promptLibraryCategoryMigrationKey,
		migratePromptLibraryLayerToCategory,
	); err != nil {
		return fmt.Errorf("migrating prompt library layer to category: %w", err)
	}
	if err := runSchemaMigrationOnce(
		db,
		promptLibraryDropKindMigrationKey,
		dropPromptLibraryKindColumn,
	); err != nil {
		return fmt.Errorf("dropping prompt library kind column: %w", err)
	}
	if err := db.AutoMigrate(&domain.PromptCategoryModel{}, &domain.PromptLibraryEntryModel{}); err != nil {
		return fmt.Errorf("initializing prompt library database: %w", err)
	}
	return nil
}

func migratePromptLibraryLayerToCategory(db *gorm.DB) error {
	const tableName = "prompt_library_entries"
	if !db.Migrator().HasTable(tableName) || !sqliteColumnExists(db, tableName, "layer") {
		return nil
	}
	if !sqliteColumnExists(db, tableName, "category") {
		if err := db.Exec("ALTER TABLE " + tableName + " ADD COLUMN category text NOT NULL DEFAULT ''").Error; err != nil {
			return fmt.Errorf("adding prompt library category column: %w", err)
		}
	}
	if err := db.Exec(`
UPDATE prompt_library_entries
SET category = CASE
	WHEN trim(layer) IN ('scene_style', 'tone') THEN 'extra'
	WHEN trim(layer) <> '' THEN trim(layer)
	WHEN trim(category) <> '' THEN trim(category)
	ELSE 'extra'
END
`).Error; err != nil {
		return fmt.Errorf("copying prompt library layer values to category: %w", err)
	}
	if err := db.Exec("DROP INDEX IF EXISTS prompt_library_entries_layer_idx").Error; err != nil {
		return fmt.Errorf("dropping prompt library layer index: %w", err)
	}
	if err := db.Exec("ALTER TABLE " + tableName + " DROP COLUMN layer").Error; err != nil {
		return fmt.Errorf("dropping prompt library layer column: %w", err)
	}
	return nil
}

func dropPromptLibraryKindColumn(db *gorm.DB) error {
	const tableName = "prompt_library_entries"
	if !db.Migrator().HasTable(tableName) || !sqliteColumnExists(db, tableName, "kind") {
		return nil
	}
	if err := db.Exec("DROP INDEX IF EXISTS prompt_library_entries_type_kind_idx").Error; err != nil {
		return fmt.Errorf("dropping prompt library type/kind index: %w", err)
	}
	if err := db.Exec("ALTER TABLE " + tableName + " DROP COLUMN kind").Error; err != nil {
		return fmt.Errorf("dropping prompt library kind column: %w", err)
	}
	return nil
}

// EnsureAgentSessionSchema migrates agent session tables.
func EnsureAgentSessionSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.AgentSessionModel{}); err != nil {
		return fmt.Errorf("initializing agent session database: %w", err)
	}
	return nil
}

type legacyGenerationTaskProviderModel struct {
	Channel  string `gorm:"column:channel"`
	Provider string `gorm:"column:provider"`
}

func (legacyGenerationTaskProviderModel) TableName() string {
	return (domain.GenerationTaskModel{}).TableName()
}

func renameGenerationTaskProviderColumn(db *gorm.DB) error {
	migrator := db.Migrator()
	if !migrator.HasColumn(&legacyGenerationTaskProviderModel{}, "channel") ||
		migrator.HasColumn(&legacyGenerationTaskProviderModel{}, "provider") {
		return nil
	}
	if err := migrator.RenameColumn(&legacyGenerationTaskProviderModel{}, "channel", "provider"); err != nil {
		return err
	}
	return nil
}

func backfillOfficialGenerationTaskProviders(db *gorm.DB) error {
	for _, route := range coregeneration.Routes() {
		if coregeneration.ProviderTypeOf(route.Provider) != coregeneration.ProviderTypeOfficial {
			continue
		}
		if route.Provider == "" {
			continue
		}
		if err := db.Model(&domain.GenerationTaskModel{}).
			Where("provider = ? AND route_id = ?", string(coregeneration.ProviderTypeOfficial), route.ID).
			Update("provider", route.Provider).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizePersistedGenerationTaskStatuses(db *gorm.DB) error {
	return db.Model(&domain.GenerationTaskModel{}).
		Where("status <> lower(trim(status))").
		Update("status", gorm.Expr("lower(trim(status))")).Error
}

type persistedGenerationAssetForBackfill struct {
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Base64    string `json:"base64"`
	MIMEType  string `json:"mimeType"`
	SlotIndex int    `json:"slotIndex"`
	Selected  bool   `json:"selected"`
}

func backfillNormalizedGenerationAssetRows(db *gorm.DB) error {
	tasks := []domain.GenerationTaskModel{}
	if err := db.Find(&tasks).Error; err != nil {
		return fmt.Errorf("loading generation tasks for asset backfill: %w", err)
	}
	for _, task := range tasks {
		assets := decodePersistedGenerationAssetsForBackfill(task.AssetsJSON)
		if len(assets) == 0 {
			continue
		}
		deletedSlots := decodeDeletedAssetSlotsForBackfill(task.DeletedAssetSlotsJSON)
		taskAssetRows := generationTaskAssetBackfillRows(task, assets, deletedSlots)
		projectResourceRows := projectResourceAssetBackfillRows(task, assets, deletedSlots)
		projectSelectedRows := projectSelectedAssetBackfillRows(task, assets, deletedSlots)
		if len(taskAssetRows) > 0 {
			if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&taskAssetRows).Error; err != nil {
				return fmt.Errorf("backfilling generation task assets for %s: %w", task.ID, err)
			}
		}
		if len(projectResourceRows) > 0 {
			if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&projectResourceRows).Error; err != nil {
				return fmt.Errorf("backfilling project resource assets for %s: %w", task.ID, err)
			}
		}
		if len(projectSelectedRows) > 0 {
			if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&projectSelectedRows).Error; err != nil {
				return fmt.Errorf("backfilling project selected assets for %s: %w", task.ID, err)
			}
		}
	}
	return nil
}

func backfillProjectSelectedAssetRows(db *gorm.DB) error {
	resourceRows := []domain.ProjectResourceAssetModel{}
	if err := db.Find(&resourceRows).Error; err != nil {
		return fmt.Errorf("loading project resource assets for selected asset backfill: %w", err)
	}
	if len(resourceRows) == 0 {
		return nil
	}
	selectedRows := make([]domain.ProjectSelectedAssetModel, 0, len(resourceRows))
	for _, row := range resourceRows {
		selectedRows = append(selectedRows, projectSelectedAssetBackfillRowFromResource(row))
	}
	if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&selectedRows).Error; err != nil {
		return fmt.Errorf("creating project selected asset backfill rows: %w", err)
	}
	return nil
}

func decodePersistedGenerationAssetsForBackfill(raw string) []persistedGenerationAssetForBackfill {
	assets := []persistedGenerationAssetForBackfill{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &assets); err != nil {
		return []persistedGenerationAssetForBackfill{}
	}
	return assets
}

func decodeDeletedAssetSlotsForBackfill(raw string) map[int]struct{} {
	slots := []int{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &slots); err != nil {
		return map[int]struct{}{}
	}
	deleted := make(map[int]struct{}, len(slots))
	for _, slot := range slots {
		if slot >= 0 {
			deleted[slot] = struct{}{}
		}
	}
	return deleted
}

func generationTaskAssetBackfillRows(task domain.GenerationTaskModel, assets []persistedGenerationAssetForBackfill, deletedSlots map[int]struct{}) []domain.GenerationTaskAssetModel {
	rows := make([]domain.GenerationTaskAssetModel, 0, len(assets))
	for index, asset := range assets {
		if _, deleted := deletedSlots[index]; deleted {
			continue
		}
		rows = append(rows, domain.GenerationTaskAssetModel{
			TaskID:         task.ID,
			AssetIndex:     index,
			LibraryAssetID: libraryAssetIDFromGeneratedAssetURL(asset.URL),
			Kind:           strings.TrimSpace(asset.Kind),
			Title:          strings.TrimSpace(asset.Title),
			URL:            strings.TrimSpace(asset.URL),
			Base64:         strings.TrimSpace(asset.Base64),
			MIMEType:       strings.TrimSpace(asset.MIMEType),
			Selected:       asset.Selected,
			CreatedAt:      task.CreatedAt,
			UpdatedAt:      task.UpdatedAt,
		})
	}
	return rows
}

func projectResourceAssetBackfillRows(task domain.GenerationTaskModel, assets []persistedGenerationAssetForBackfill, deletedSlots map[int]struct{}) []domain.ProjectResourceAssetModel {
	projectID := domain.CleanProjectID(task.ProjectID)
	resourceType := normalizedProjectResourceTypeForBackfill(task.CapabilityID)
	if projectID == "" || resourceType == "" {
		return []domain.ProjectResourceAssetModel{}
	}
	rows := []domain.ProjectResourceAssetModel{}
	for index, asset := range assets {
		if _, deleted := deletedSlots[index]; deleted || !asset.Selected || strings.TrimSpace(asset.Kind) != "image" {
			continue
		}
		rows = append(rows, domain.ProjectResourceAssetModel{
			ID:             fmt.Sprintf("%s:%d", task.ID, index),
			ProjectID:      projectID,
			ResourceType:   resourceType,
			TaskID:         task.ID,
			AssetIndex:     index,
			LibraryAssetID: libraryAssetIDFromGeneratedAssetURL(asset.URL),
			Kind:           strings.TrimSpace(asset.Kind),
			Title:          strings.TrimSpace(asset.Title),
			URL:            strings.TrimSpace(asset.URL),
			Base64:         strings.TrimSpace(asset.Base64),
			MIMEType:       strings.TrimSpace(asset.MIMEType),
			CreatedAt:      task.CreatedAt,
			UpdatedAt:      task.UpdatedAt,
		})
	}
	return rows
}

func projectSelectedAssetBackfillRows(task domain.GenerationTaskModel, assets []persistedGenerationAssetForBackfill, deletedSlots map[int]struct{}) []domain.ProjectSelectedAssetModel {
	projectID := domain.CleanProjectID(task.ProjectID)
	resourceType := normalizedProjectResourceTypeForBackfill(task.CapabilityID)
	if projectID == "" || resourceType == "" {
		return []domain.ProjectSelectedAssetModel{}
	}
	rows := []domain.ProjectSelectedAssetModel{}
	for index, asset := range assets {
		if _, deleted := deletedSlots[index]; deleted || !asset.Selected || strings.TrimSpace(asset.Kind) != "image" {
			continue
		}
		libraryAssetID := libraryAssetIDFromGeneratedAssetURL(asset.URL)
		row := domain.ProjectSelectedAssetModel{
			ProjectID:        projectID,
			ResourceType:     resourceType,
			ResourceTitle:    strings.TrimSpace(asset.Title),
			MediaAssetID:     libraryAssetID,
			Kind:             strings.TrimSpace(asset.Kind),
			Title:            strings.TrimSpace(asset.Title),
			URL:              strings.TrimSpace(asset.URL),
			Base64:           strings.TrimSpace(asset.Base64),
			MIMEType:         strings.TrimSpace(asset.MIMEType),
			SourceType:       "generated",
			SourceTaskID:     task.ID,
			SourceAssetIndex: index,
			CreatedAt:        task.CreatedAt,
			UpdatedAt:        task.UpdatedAt,
		}
		row.ID = projectSelectedAssetBackfillID(row)
		rows = append(rows, row)
	}
	return rows
}

func projectSelectedAssetBackfillRowFromResource(resource domain.ProjectResourceAssetModel) domain.ProjectSelectedAssetModel {
	row := domain.ProjectSelectedAssetModel{
		ProjectID:        domain.CleanProjectID(resource.ProjectID),
		ResourceType:     strings.TrimSpace(resource.ResourceType),
		ResourceTitle:    strings.TrimSpace(resource.Title),
		MediaAssetID:     strings.TrimSpace(resource.LibraryAssetID),
		Kind:             strings.TrimSpace(resource.Kind),
		Title:            strings.TrimSpace(resource.Title),
		URL:              strings.TrimSpace(resource.URL),
		Base64:           strings.TrimSpace(resource.Base64),
		MIMEType:         strings.TrimSpace(resource.MIMEType),
		SourceType:       "generated",
		SourceTaskID:     strings.TrimSpace(resource.TaskID),
		SourceAssetIndex: resource.AssetIndex,
		CreatedAt:        resource.CreatedAt,
		UpdatedAt:        resource.UpdatedAt,
	}
	row.ID = projectSelectedAssetBackfillID(row)
	return row
}

func projectSelectedAssetBackfillID(row domain.ProjectSelectedAssetModel) string {
	source := ""
	if strings.TrimSpace(row.SourceTaskID) != "" && row.SourceAssetIndex >= 0 {
		source = fmt.Sprintf("task:%s:%d", strings.TrimSpace(row.SourceTaskID), row.SourceAssetIndex)
	}
	if source == "" {
		source = strings.TrimSpace(row.MediaAssetID)
	}
	if source == "" {
		source = strings.TrimSpace(row.URL)
	}
	if source == "" {
		source = strings.TrimSpace(row.Base64)
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{
		domain.CleanProjectID(row.ProjectID),
		strings.TrimSpace(row.ResourceType),
		strings.TrimSpace(row.ResourceID),
		strings.TrimSpace(row.ResourceTitle),
		strings.TrimSpace(row.Kind),
		source,
	}, "\x00")))
	return "selected-" + hex.EncodeToString(sum[:])[:24]
}

func normalizedProjectResourceTypeForBackfill(value string) string {
	switch strings.TrimSpace(value) {
	case "character", "scene", "storyboard", "prop":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func libraryAssetIDFromGeneratedAssetURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for index, segment := range segments {
		if segment != "media-assets" || index+2 >= len(segments) || segments[index+2] != "content" {
			continue
		}
		id, err := url.PathUnescape(segments[index+1])
		if err != nil {
			return segments[index+1]
		}
		return strings.TrimSpace(id)
	}
	return ""
}

// IsRecordNotFound reports whether err is the repository not-found sentinel.
func IsRecordNotFound(err error) bool {
	return errors.Is(err, ErrRecordNotFound)
}
