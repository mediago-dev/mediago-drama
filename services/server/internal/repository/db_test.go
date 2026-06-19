package repository

import (
	"path/filepath"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
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
		&domain.AgentSessionModel{},
		&domain.DocumentEditStreamModel{},
		&domain.ProjectAssetModel{},
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
		"agent_runs",
		"agent_event_logs",
		"agent_chat_snapshots",
	}
	for _, table := range removedTables {
		if db.Migrator().HasTable(table) {
			t.Fatalf("table %s should not be created", table)
		}
	}
	if sqliteColumnExists(db, "projects", "document_count") {
		t.Fatal("projects should not include deprecated document_count column")
	}
	if !db.Migrator().HasColumn(&domain.ProjectAssetModel{}, "folder_id") {
		t.Fatal("project_assets should include folder_id column")
	}
}

func TestEnsureWorkspaceSchemaDropsDeprecatedDocumentStorage(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE projects (id text primary key, name text not null, category text, description text, project_dir text, relative_dir text, document_count integer, created_at text, updated_at text)`,
		`CREATE TABLE documents (project_id text, id text, title text, content text, content_persisted boolean, folder_id text)`,
		`CREATE TABLE document_folders (project_id text, id text, name text, parent_id text)`,
		`CREATE TABLE asset_folders (project_id text, id text, name text, parent_id text)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("preparing legacy schema: %v", err)
		}
	}

	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema returned error: %v", err)
	}
	if db.Migrator().HasTable("documents") {
		t.Fatal("documents table should be dropped")
	}
	if db.Migrator().HasTable("document_folders") {
		t.Fatal("document_folders table should be dropped")
	}
	if db.Migrator().HasTable("asset_folders") {
		t.Fatal("asset_folders table should be dropped")
	}
	if sqliteColumnExists(db, "projects", "document_count") {
		t.Fatal("projects.document_count should be dropped")
	}
	assertSchemaMigrationRecorded(t, db, workspaceDropDeprecatedStorageMigrationKey)
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
		repos.ProjectAssets == nil {
		t.Fatalf("repositories = %#v, want all workspace repositories", repos)
	}
}

func TestOpenSettingsRepositoriesMigratesAllSettingsSchemas(t *testing.T) {
	repos, err := OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories returned error: %v", err)
	}
	if repos.DB == nil || repos.APIKeys == nil || repos.AgentModelProfiles == nil || repos.Billing == nil || repos.GenerationNotifications == nil || repos.GenerationPreferences == nil || repos.GenerationTasks == nil || repos.MediaAssets == nil || repos.PromptLibrary == nil {
		t.Fatalf("repositories = %#v, want all settings repositories", repos)
	}

	models := []any{
		&domain.APIKeyModel{},
		&domain.AgentModelProfileModel{},
		&domain.MediaAssetModel{},
		&domain.GenerationConversationModel{},
		&domain.GenerationNotificationModel{},
		&domain.GenerationPreferenceModel{},
		&domain.GenerationTaskModel{},
		&domain.GenerationTaskAttemptModel{},
		&domain.PromptLibraryEntryModel{},
	}
	for _, model := range models {
		if !repos.DB.Migrator().HasTable(model) {
			t.Fatalf("expected table for %T to exist", model)
		}
	}
}

func TestEnsureAgentModelProfileSchemaMigratesMiniMaxTemplateToDomesticEndpoint(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	if err := db.AutoMigrate(&domain.AgentModelProfileModel{}); err != nil {
		t.Fatalf("AutoMigrate returned error: %v", err)
	}
	insertedAt := "2026-06-01T00:00:00Z"
	profiles := []domain.AgentModelProfileModel{
		{
			ID:               "minimax",
			Name:             "MiniMax",
			ProviderID:       "minimax",
			ProviderLabel:    "MiniMax",
			BaseURL:          "https://api.minimax.io/v1",
			Model:            "MiniMax-M3",
			ModelDisplayName: "MiniMax M3",
			Enabled:          true,
			APIKeyName:       "agent-model:minimax:api-key",
			CreatedAt:        insertedAt,
			UpdatedAt:        insertedAt,
		},
		{
			ID:               "minimax-proxy",
			Name:             "MiniMax Proxy",
			ProviderID:       "minimax-proxy",
			ProviderLabel:    "MiniMax Proxy",
			BaseURL:          "https://proxy.example.com/v1",
			Model:            "MiniMax-M3",
			ModelDisplayName: "MiniMax M3",
			Enabled:          true,
			APIKeyName:       "agent-model:minimax-proxy:api-key",
			CreatedAt:        insertedAt,
			UpdatedAt:        insertedAt,
		},
	}
	for _, profile := range profiles {
		if err := db.Create(&profile).Error; err != nil {
			t.Fatalf("inserting profile %q: %v", profile.ID, err)
		}
	}

	if err := EnsureAgentModelProfileSchema(db); err != nil {
		t.Fatalf("EnsureAgentModelProfileSchema returned error: %v", err)
	}

	var minimax domain.AgentModelProfileModel
	if err := db.First(&minimax, "id = ?", "minimax").Error; err != nil {
		t.Fatalf("loading migrated minimax profile: %v", err)
	}
	if minimax.BaseURL != "https://api.minimaxi.com/v1" {
		t.Fatalf("minimax baseURL = %q, want domestic endpoint", minimax.BaseURL)
	}
	if minimax.ProviderID != "minimax-cn" {
		t.Fatalf("minimax providerID = %q, want minimax-cn", minimax.ProviderID)
	}
	if minimax.Name != "MiniMax 国内" || minimax.ProviderLabel != "MiniMax 国内" {
		t.Fatalf("minimax labels = (%q, %q), want domestic labels", minimax.Name, minimax.ProviderLabel)
	}
	if minimax.APIKeyName != "agent-model:minimax:api-key" {
		t.Fatalf("minimax apiKeyName = %q, want existing profile key preserved", minimax.APIKeyName)
	}
	assertSchemaMigrationRecorded(t, db, agentModelProfileMiniMaxMigrationKey)
	var custom domain.AgentModelProfileModel
	if err := db.First(&custom, "id = ?", "minimax-proxy").Error; err != nil {
		t.Fatalf("loading custom profile: %v", err)
	}
	if custom.BaseURL != "https://proxy.example.com/v1" {
		t.Fatalf("custom baseURL = %q, want unchanged", custom.BaseURL)
	}
}

func TestEnsureGenerationTaskSchemaRenamesAndBackfillsProvider(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite returned error: %v", err)
	}
	if err := db.AutoMigrate(&legacyGenerationTaskWithChannelModel{}); err != nil {
		t.Fatalf("creating legacy generation_tasks table: %v", err)
	}
	if err := db.Create(&legacyGenerationTaskWithChannelModel{
		ID:                    "task-official",
		Kind:                  "image",
		RouteID:               coregeneration.RouteOfficialSeedream5Lite,
		FamilyID:              coregeneration.FamilySeedream,
		VersionID:             coregeneration.VersionSeedream5Lite,
		Channel:               string(coregeneration.ProviderTypeOfficial),
		Model:                 "doubao-seedream-5-0-260128",
		Prompt:                "prompt",
		ReferenceURLsJSON:     "[]",
		ReferenceAssetIDsJSON: "[]",
		ParamsJSON:            "{}",
		Status:                " COMPLETED ",
		Message:               "done",
		AssetsJSON:            "[]",
		UsageJSON:             "{}",
		CreatedAt:             "2026-06-01T00:00:00Z",
		UpdatedAt:             "2026-06-01T00:00:00Z",
	}).Error; err != nil {
		t.Fatalf("inserting legacy generation task: %v", err)
	}

	if err := EnsureGenerationTaskSchema(db); err != nil {
		t.Fatalf("EnsureGenerationTaskSchema returned error: %v", err)
	}
	if db.Migrator().HasColumn(&legacyGenerationTaskProviderModel{}, "channel") {
		t.Fatal("legacy channel column should have been renamed")
	}
	if !db.Migrator().HasColumn(&domain.GenerationTaskModel{}, "provider") {
		t.Fatal("generation_tasks should include provider column")
	}

	var task domain.GenerationTaskModel
	if err := db.First(&task, "id = ?", "task-official").Error; err != nil {
		t.Fatalf("loading migrated task: %v", err)
	}
	if task.Provider != coregeneration.ProviderVolcengine {
		t.Fatalf("provider = %q, want %q", task.Provider, coregeneration.ProviderVolcengine)
	}
	if task.Status != "completed" {
		t.Fatalf("status = %q, want completed", task.Status)
	}
	if !db.Migrator().HasIndex(&domain.GenerationTaskModel{}, "generation_tasks_kind_status_updated_idx") {
		t.Fatal("generation_tasks should include kind/status/updated_at index")
	}
	assertSchemaMigrationRecorded(t, db, generationTaskProviderBackfillMigrationKey)
	assertSchemaMigrationRecorded(t, db, generationTaskStatusNormalizeMigrationKey)
	if err := EnsureGenerationTaskSchema(db); err != nil {
		t.Fatalf("EnsureGenerationTaskSchema second run returned error: %v", err)
	}
}

type legacyGenerationTaskWithChannelModel struct {
	ID                    string `gorm:"column:id;primaryKey"`
	ProviderTaskID        string `gorm:"column:provider_task_id;not null;default:'';index:generation_tasks_provider_task_id_idx"`
	ConversationID        string `gorm:"column:conversation_id;not null;default:'';index:generation_tasks_conversation_idx,priority:1"`
	ProjectID             string `gorm:"column:project_id;not null;default:'';index:generation_tasks_project_id_idx"`
	CapabilityID          string `gorm:"column:capability_id;not null;default:'';index:generation_tasks_capability_idx"`
	Kind                  string `gorm:"column:kind;not null"`
	RouteID               string `gorm:"column:route_id;not null"`
	FamilyID              string `gorm:"column:family_id;not null"`
	VersionID             string `gorm:"column:version_id;not null"`
	Channel               string `gorm:"column:channel;not null"`
	ModelID               string `gorm:"column:model_id;not null"`
	Model                 string `gorm:"column:model;not null"`
	Prompt                string `gorm:"column:prompt;not null"`
	ReferenceURLsJSON     string `gorm:"column:reference_urls_json;not null"`
	ReferenceAssetIDsJSON string `gorm:"column:reference_asset_ids_json;not null;default:'[]'"`
	ParamsJSON            string `gorm:"column:params_json;not null"`
	Status                string `gorm:"column:status;not null"`
	Message               string `gorm:"column:message;not null"`
	Text                  string `gorm:"column:text;not null;default:''"`
	AssetsJSON            string `gorm:"column:assets_json;not null"`
	UsageJSON             string `gorm:"column:usage_json;not null"`
	Error                 string `gorm:"column:error;not null;default:''"`
	ErrorCode             string `gorm:"column:error_code;not null;default:''"`
	ErrorType             string `gorm:"column:error_type;not null;default:''"`
	Retryable             bool   `gorm:"column:retryable;not null;default:false"`
	CreatedAt             string `gorm:"column:created_at;not null"`
	UpdatedAt             string `gorm:"column:updated_at;not null"`
}

func (legacyGenerationTaskWithChannelModel) TableName() string {
	return "generation_tasks"
}

func assertSchemaMigrationRecorded(t *testing.T, db *gorm.DB, key string) {
	t.Helper()
	var record schemaMigrationRecord
	if err := db.First(&record, "key = ?", key).Error; err != nil {
		t.Fatalf("schema migration %q was not recorded: %v", key, err)
	}
}
