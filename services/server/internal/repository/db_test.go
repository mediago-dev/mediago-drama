package repository

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

func TestOpenWorkspaceDBMigratesWorkspaceSchema(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB returned error: %v", err)
	}

	models := []any{
		&domain.WorkspaceProjectModel{},
		&domain.EpisodeTimelineModel{},
		&domain.DocumentOperationLogModel{},
		&domain.DocumentToolApprovalModel{},
		&domain.DocumentEditStreamModel{},
		&domain.AgentSessionModel{},
		&domain.AssetModel{},
		&domain.GenerationConversationModel{},
		&domain.GenerationTaskModel{},
		&domain.GenerationTaskAttemptModel{},
		&domain.GenerationTaskReferenceModel{},
		&domain.GenerationTaskAssetModel{},
		&domain.GenerationTaskDeletedSlotModel{},
		&domain.ProjectSelectedAssetModel{},
		&domain.ProjectReferenceAssetModel{},
		&domain.GenerationNotificationModel{},
		&domain.AgentWorkflowModel{},
		&domain.AgentTaskModel{},
		&domain.AgentInvocationModel{},
		&domain.AgentArtifactModel{},
		&domain.AgentWorkflowEventModel{},
		&domain.AgentRootProposalModel{},
		&domain.AgentRootFinalDeliveryModel{},
		&domain.AgentWorkflowHandoffModel{},
		&domain.AgentQueuedInputModel{},
	}
	for _, model := range models {
		if !db.Migrator().HasTable(model) {
			t.Fatalf("expected table for %T to exist", model)
		}
	}

	removedTables := []string{
		"documents",
		"document_folders",
		"asset_folders",
		"library_assets",
		"media_assets",
		"project_assets",
		"project_resource_assets",
	}
	for _, table := range removedTables {
		if db.Migrator().HasTable(table) {
			t.Fatalf("table %s should not be created", table)
		}
	}
}

func TestOpenGormSQLiteCachesByPath(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cached.sqlite")
	first, err := OpenGormSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenGormSQLite first call returned error: %v", err)
	}
	second, err := OpenGormSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenGormSQLite second call returned error: %v", err)
	}
	if first != second {
		t.Fatal("OpenGormSQLite returned different DB handles for the same path")
	}
}

func TestOpenGormSQLiteConfiguresLocalPragmas(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "local.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}

	var journalMode string
	if err := db.Raw("PRAGMA journal_mode").Scan(&journalMode).Error; err != nil {
		t.Fatalf("reading journal_mode: %v", err)
	}
	if journalMode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}

	var synchronous int
	if err := db.Raw("PRAGMA synchronous").Scan(&synchronous).Error; err != nil {
		t.Fatalf("reading synchronous: %v", err)
	}
	if synchronous != 1 {
		t.Fatalf("synchronous = %d, want 1 (NORMAL)", synchronous)
	}

	var foreignKeys int
	if err := db.Raw("PRAGMA foreign_keys").Scan(&foreignKeys).Error; err != nil {
		t.Fatalf("reading foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}
}

func TestOpenGormSQLiteRestrictsDatabaseFilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not expose Unix permission bits")
	}
	dir := filepath.Join(t.TempDir(), "database")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatalf("creating database directory: %v", err)
	}
	dbPath := filepath.Join(dir, "settings.sqlite")
	db, err := OpenGormSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	if err := db.Exec("CREATE TABLE permission_probe (id INTEGER PRIMARY KEY)").Error; err != nil {
		t.Fatalf("creating permission probe: %v", err)
	}
	if err := tightenSQLiteFilePermissions(dbPath); err != nil {
		t.Fatalf("tightenSQLiteFilePermissions returned error: %v", err)
	}

	dirInfo, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stating database directory: %v", err)
	}
	if got := dirInfo.Mode().Perm(); got != 0o700 {
		t.Fatalf("database directory mode = %o, want 700", got)
	}
	for _, path := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		info, statErr := os.Stat(path)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil {
			t.Fatalf("stating %s: %v", filepath.Base(path), statErr)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("%s mode = %o, want 600", filepath.Base(path), got)
		}
	}
}

func TestOpenWorkspaceRepositoriesBuildsAllWorkspaceRepositories(t *testing.T) {
	repos, err := OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories returned error: %v", err)
	}
	if repos.DB == nil ||
		repos.Workspace == nil ||
		repos.EditStreams == nil ||
		repos.AgentSessions == nil ||
		repos.Approvals == nil ||
		repos.DocumentSections == nil ||
		repos.Billing == nil ||
		repos.GenerationNotifications == nil ||
		repos.GenerationTasks == nil ||
		repos.MediaAssets == nil ||
		repos.ProjectAssets == nil {
		t.Fatalf("repositories = %#v, want all workspace repositories", repos)
	}
	if repos.AgentExecution == nil || repos.AgentWorkflowUoW == nil || repos.Selections == nil {
		t.Fatalf("repositories = %#v, want agent execution repositories", repos)
	}
}

func TestOpenSettingsRepositoriesMigratesOnlyGlobalSettingsSchemas(t *testing.T) {
	repos, err := OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories returned error: %v", err)
	}
	if repos.DB == nil ||
		repos.APIKeys == nil ||
		repos.AgentModelProfiles == nil ||
		repos.AppSettings == nil ||
		repos.GenerationPreferences == nil ||
		repos.Instructions == nil ||
		repos.PromptLibrary == nil {
		t.Fatalf("repositories = %#v, want all settings repositories", repos)
	}

	settingsModels := []any{
		&domain.APIKeyModel{},
		&domain.AgentModelProfileModel{},
		&domain.InstructionTemplateModel{},
		&domain.PromptCategoryModel{},
		&domain.PromptLibraryEntryModel{},
		&domain.GenerationPreferenceModel{},
		&domain.AppSettingModel{},
	}
	for _, model := range settingsModels {
		if !repos.DB.Migrator().HasTable(model) {
			t.Fatalf("expected settings table for %T to exist", model)
		}
	}

	workspaceTables := []string{
		"projects",
		"assets",
		"generation_tasks",
		"generation_task_assets",
		"generation_task_deleted_slots",
		"project_selected_assets",
		"project_reference_assets",
		"generation_notifications",
	}
	for _, table := range workspaceTables {
		if repos.DB.Migrator().HasTable(table) {
			t.Fatalf("settings schema should not create workspace table %s", table)
		}
	}

	err = repos.DB.Create(&domain.AssetModel{
		ID:            "asset-settings-db",
		Kind:          "image",
		Filename:      "settings-db.png",
		MIMEType:      "image/png",
		RelPath:       "library/settings-db.png",
		URL:           "/api/v1/media-assets/asset-settings-db/content",
		StorageStatus: "ready",
		CreatedAt:     domain.TimeFromString("2026-06-21T00:00:00Z"),
		UpdatedAt:     domain.TimeFromString("2026-06-21T00:00:00Z"),
	}).Error
	if err == nil {
		t.Fatal("settings database accepted workspace asset row; assets should only live in app.db")
	}
}

func TestWorkspaceSchemaCascadesProjectOwnedRows(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB returned error: %v", err)
	}

	now := domain.TimeFromString("2026-06-21T00:00:00Z")
	projectID := "project-cascade"
	assetID := "asset-cascade"
	taskID := "task-cascade"
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        "Cascade",
		Category:    "drama",
		Status:      "active",
		RelativeDir: "projects/cascade",
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}
	if err := db.Create(&domain.AssetModel{
		ID:            assetID,
		ProjectID:     domain.StringPtr(projectID),
		Kind:          "image",
		Filename:      "cascade.png",
		MIMEType:      "image/png",
		RelPath:       "library/cascade.png",
		URL:           "/api/v1/media-assets/asset-cascade/content",
		Source:        "generated",
		StorageStatus: "ready",
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("creating asset fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationConversationModel{
		ID:        "session-cascade",
		ScopeID:   "project:" + projectID,
		Kind:      "image",
		Title:     "Cascade session",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating conversation fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationTaskModel{
		ID:             taskID,
		ConversationID: domain.StringPtr("session-cascade"),
		ProjectID:      domain.StringPtr(projectID),
		CapabilityID:   domain.StringPtr("character"),
		Kind:           "image",
		RouteID:        "route",
		FamilyID:       "family",
		VersionID:      "version",
		Provider:       "provider",
		ModelID:        "model-id",
		Model:          "model",
		Prompt:         "prompt",
		ParamsJSON:     "{}",
		Status:         "completed",
		Message:        "done",
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("creating generation task fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationTaskReferenceModel{
		TaskID:    taskID,
		RefIndex:  0,
		AssetID:   domain.StringPtr(assetID),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating task reference fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationTaskAssetModel{
		TaskID:    taskID,
		SlotIndex: 0,
		AssetID:   assetID,
		Selected:  true,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating task asset fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationTaskDeletedSlotModel{
		TaskID:    taskID,
		SlotIndex: 1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating task deleted slot fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationTaskAttemptModel{
		ID:        "attempt-cascade",
		TaskID:    taskID,
		Action:    "create",
		Status:    "completed",
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating task attempt fixture: %v", err)
	}
	if err := db.Create(&domain.ProjectSelectedAssetModel{
		ID:              "selected-cascade",
		ProjectID:       projectID,
		ResourceType:    "character",
		ResourceTitle:   domain.StringPtr("Cascade"),
		AssetID:         assetID,
		SourceType:      domain.StringPtr("generated"),
		SourceTaskID:    domain.StringPtr(taskID),
		SourceSlotIndex: 0,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("creating selected asset fixture: %v", err)
	}
	if err := db.Create(&domain.ProjectReferenceAssetModel{
		ID:        "reference-cascade",
		ProjectID: projectID,
		AssetID:   assetID,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating project reference fixture: %v", err)
	}
	if err := db.Create(&domain.GenerationNotificationModel{
		ID:          "notification-cascade",
		TaskID:      taskID,
		TaskKind:    "image",
		TaskStatus:  "completed",
		ProjectID:   domain.StringPtr(projectID),
		Title:       "Done",
		Description: "Done",
		TargetJSON:  "{}",
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating notification fixture: %v", err)
	}

	if err := db.Delete(&domain.WorkspaceProjectModel{ID: projectID}).Error; err != nil {
		t.Fatalf("deleting project: %v", err)
	}
	for _, tc := range []struct {
		name  string
		model any
	}{
		{name: "projects", model: &domain.WorkspaceProjectModel{}},
		{name: "assets", model: &domain.AssetModel{}},
		{name: "generation_tasks", model: &domain.GenerationTaskModel{}},
		{name: "generation_task_references", model: &domain.GenerationTaskReferenceModel{}},
		{name: "generation_task_assets", model: &domain.GenerationTaskAssetModel{}},
		{name: "generation_task_deleted_slots", model: &domain.GenerationTaskDeletedSlotModel{}},
		{name: "generation_task_attempts", model: &domain.GenerationTaskAttemptModel{}},
		{name: "project_selected_assets", model: &domain.ProjectSelectedAssetModel{}},
		{name: "project_reference_assets", model: &domain.ProjectReferenceAssetModel{}},
		{name: "generation_notifications", model: &domain.GenerationNotificationModel{}},
	} {
		assertModelCount(t, db, tc.name, tc.model, 0)
	}
	assertModelCount(t, db, "generation_conversations", &domain.GenerationConversationModel{}, 1)
}

func assertModelCount(t *testing.T, db *gorm.DB, name string, model any, want int64) {
	t.Helper()
	var count int64
	if err := db.Model(model).Count(&count).Error; err != nil {
		t.Fatalf("counting %s: %v", name, err)
	}
	if count != want {
		t.Fatalf("%s count = %d, want %d", name, count, want)
	}
}

func TestEnsureWorkspaceSchemaUsesNormalizedGenerationTaskColumns(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema returned error: %v", err)
	}

	for _, column := range []string{
		"assets_json",
		"deleted_asset_slots_json",
		"usage_json",
		"reference_urls_json",
		"reference_asset_ids_json",
	} {
		if testColumnExists(t, db, "generation_tasks", column) {
			t.Fatalf("generation_tasks should not include removed column %s", column)
		}
	}
	for _, column := range []string{
		"document_id",
		"input_tokens",
		"output_tokens",
		"total_tokens",
		"reasoning_tokens",
		"cached_tokens",
	} {
		if !testColumnExists(t, db, "generation_tasks", column) {
			t.Fatalf("generation_tasks should include token column %s", column)
		}
	}
	if !db.Migrator().HasTable(&domain.GenerationTaskReferenceModel{}) {
		t.Fatal("generation_task_references table should exist")
	}
	if !db.Migrator().HasTable(&domain.GenerationTaskAssetModel{}) {
		t.Fatal("generation_task_assets table should exist")
	}
	if !db.Migrator().HasTable(&domain.GenerationTaskDeletedSlotModel{}) {
		t.Fatal("generation_task_deleted_slots table should exist")
	}
}

func TestEnsureWorkspaceSchemaCreatesAssetsWithoutBase64(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema returned error: %v", err)
	}
	if !db.Migrator().HasTable(&domain.AssetModel{}) {
		t.Fatal("assets table should exist")
	}
	if testColumnExists(t, db, "assets", "base64") {
		t.Fatal("assets should not persist base64")
	}
	if !testColumnExists(t, db, "assets", "rel_path") {
		t.Fatal("assets should include rel_path")
	}
}

func testColumnExists(t *testing.T, db *gorm.DB, table string, column string) bool {
	t.Helper()
	columns, err := db.Migrator().ColumnTypes(table)
	if err != nil {
		t.Fatalf("reading columns for %s: %v", table, err)
	}
	for _, info := range columns {
		if strings.EqualFold(info.Name(), column) {
			return true
		}
	}
	return false
}
