package repository

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

type legacyAgentSelectionModel struct {
	ProjectID       string     `gorm:"column:project_id;primaryKey;default:''"`
	ID              string     `gorm:"column:id;primaryKey"`
	SessionID       string     `gorm:"column:session_id;not null;default:''"`
	RunID           string     `gorm:"column:run_id;not null;default:''"`
	Kind            string     `gorm:"column:kind;not null;default:''"`
	Title           string     `gorm:"column:title;not null;default:''"`
	Prompt          string     `gorm:"column:prompt;not null;default:''"`
	OptionsJSON     string     `gorm:"column:options_json;not null;default:'[]'"`
	FieldsJSON      string     `gorm:"column:fields_json;not null;default:''"`
	AllowCustom     bool       `gorm:"column:allow_custom;not null;default:false"`
	Status          string     `gorm:"column:status;not null"`
	DecisionJSON    string     `gorm:"column:decision_json;not null;default:''"`
	CreatedAt       time.Time  `gorm:"column:created_at;not null"`
	DecidedAt       *time.Time `gorm:"column:decided_at"`
	ExpiresAt       *time.Time `gorm:"column:expires_at"`
	RetentionMode   *string    `gorm:"column:retention_mode"`
	SubmissionOwner *string    `gorm:"column:submission_owner"`
}

func (legacyAgentSelectionModel) TableName() string {
	return "agent_selections"
}

func newAgentSelectionRepositoryTest(t *testing.T) (*AgentSelectionRepository, string) {
	t.Helper()
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-agent-selection-repo"
	now := time.Now().UTC()
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        "Agent selection repository",
		Category:    "drama",
		Status:      "active",
		RelativeDir: projectID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}
	return NewAgentSelectionRepository(db), projectID
}

func TestAgentSelectionGenerationClaimUsesDatabaseCAS(t *testing.T) {
	repo, projectID := newAgentSelectionRepositoryTest(t)
	for _, column := range []string{
		"intent_json",
		"generation_claim_fingerprint",
		"generation_claimed_at",
		"generation_outcome_json",
		"generation_completed_at",
	} {
		if !repo.db.Migrator().HasColumn(&domain.AgentSelectionModel{}, column) {
			t.Fatalf("agent_selections is missing column %q", column)
		}
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Hour)
	selection := domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          "selection-generation-cas",
		SessionID:   "session-generation-cas",
		RunID:       "run-generation-cas",
		Kind:        "generation_plan",
		Title:       "Generation CAS",
		OptionsJSON: "[]",
		IntentJSON:  `{"version":1,"operation":"create_single","items":[]}`,
		Status:      "submitted",
		CreatedAt:   now,
		ExpiresAt:   &expiresAt,
	}
	if err := repo.CreateAgentSelection(selection); err != nil {
		t.Fatalf("CreateAgentSelection() error = %v", err)
	}

	const callers = 20
	start := make(chan struct{})
	results := make(chan bool, callers)
	errorsCh := make(chan error, callers)
	var group sync.WaitGroup
	for index := 0; index < callers; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			claimed, err := repo.ClaimAgentSelectionGenerationUse(
				projectID,
				selection.SessionID,
				selection.RunID,
				selection.ID,
				"fingerprint-cas",
				now,
			)
			results <- claimed
			errorsCh <- err
		}()
	}
	close(start)
	group.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		if err != nil {
			t.Fatalf("ClaimAgentSelectionGenerationUse() error = %v", err)
		}
	}
	claimedCount := 0
	for claimed := range results {
		if claimed {
			claimedCount++
		}
	}
	if claimedCount != 1 {
		t.Fatalf("claimed count = %d, want 1", claimedCount)
	}

	persisted, err := repo.GetAgentSelection(projectID, selection.ID)
	if err != nil {
		t.Fatalf("GetAgentSelection() error = %v", err)
	}
	if persisted.GenerationClaimFingerprint != "fingerprint-cas" || persisted.GenerationClaimedAt == nil {
		t.Fatalf("persisted claim = %#v, want fingerprint and claimed time", persisted)
	}

	completed, err := repo.CompleteAgentSelectionGenerationUse(
		projectID,
		selection.ID,
		"fingerprint-cas",
		`{"version":1,"result":{"taskId":"task-cas"}}`,
		now.Add(time.Second),
	)
	if err != nil || !completed {
		t.Fatalf("CompleteAgentSelectionGenerationUse() = %v, error=%v; want true", completed, err)
	}
	completed, err = repo.CompleteAgentSelectionGenerationUse(
		projectID,
		selection.ID,
		"fingerprint-cas",
		`{"version":1,"result":{"taskId":"task-other"}}`,
		now.Add(2*time.Second),
	)
	if err != nil || completed {
		t.Fatalf("second CompleteAgentSelectionGenerationUse() = %v, error=%v; want false", completed, err)
	}
}

func TestAgentSelectionGenerationClaimRestrictsKindStatusAndIntent(t *testing.T) {
	repo, projectID := newAgentSelectionRepositoryTest(t)
	now := time.Now().UTC()
	expiresAt := now.Add(time.Hour)
	tests := []struct {
		name       string
		kind       string
		status     string
		intentJSON string
		wantClaim  bool
	}{
		{name: "generation plan submitted", kind: "generation_plan", status: "submitted", intentJSON: `{"version":1}`, wantClaim: true},
		{name: "ordinary submitted form", kind: "form", status: "submitted", intentJSON: `{"version":1}`},
		{name: "generation plan selected", kind: "generation_plan", status: "selected", intentJSON: `{"version":1}`},
		{name: "ordinary selected choice", kind: "confirmation", status: "selected", intentJSON: `{"version":1}`},
		{name: "missing intent", kind: "generation_plan", status: "submitted"},
	}
	for index, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			selection := domain.AgentSelectionModel{
				ProjectID:   projectID,
				ID:          "selection-eligibility-" + string(rune('a'+index)),
				SessionID:   "session-eligibility",
				RunID:       "run-eligibility",
				Kind:        tt.kind,
				Title:       tt.name,
				OptionsJSON: "[]",
				IntentJSON:  tt.intentJSON,
				Status:      tt.status,
				CreatedAt:   now,
				ExpiresAt:   &expiresAt,
			}
			if err := repo.CreateAgentSelection(selection); err != nil {
				t.Fatalf("CreateAgentSelection() error = %v", err)
			}
			claimed, err := repo.ClaimAgentSelectionGenerationUse(
				projectID,
				selection.SessionID,
				selection.RunID,
				selection.ID,
				"fingerprint-eligibility",
				now,
			)
			if err != nil || claimed != tt.wantClaim {
				t.Fatalf("ClaimAgentSelectionGenerationUse() = %v, error=%v; want %v", claimed, err, tt.wantClaim)
			}
		})
	}
}

func TestEnsureWorkspaceSchemaAddsGenerationClaimColumnsWithoutLosingSelections(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "legacy-workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite() error = %v", err)
	}
	if err := db.AutoMigrate(&domain.WorkspaceProjectModel{}, &legacyAgentSelectionModel{}); err != nil {
		t.Fatalf("creating legacy schema: %v", err)
	}
	now := time.Now().UTC()
	projectID := "project-legacy-agent-selection"
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID: projectID, Name: "Legacy", Category: "drama", Status: "active", RelativeDir: projectID,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating legacy project: %v", err)
	}
	legacy := legacyAgentSelectionModel{
		ProjectID: projectID, ID: "selection-legacy", SessionID: "session-legacy", RunID: "run-legacy",
		Kind: "form", Title: "Keep me", OptionsJSON: "[]", Status: "submitted", CreatedAt: now,
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("creating legacy selection: %v", err)
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema() error = %v", err)
	}
	for _, column := range []string{
		"intent_json",
		"generation_claim_fingerprint",
		"generation_claimed_at",
		"generation_outcome_json",
		"generation_completed_at",
	} {
		if !db.Migrator().HasColumn(&domain.AgentSelectionModel{}, column) {
			t.Fatalf("migrated agent_selections is missing column %q", column)
		}
	}
	persisted, err := NewAgentSelectionRepository(db).GetAgentSelection(projectID, legacy.ID)
	if err != nil {
		t.Fatalf("GetAgentSelection() error = %v", err)
	}
	if persisted.Title != legacy.Title || persisted.SessionID != legacy.SessionID || persisted.IntentJSON != "" || persisted.GenerationClaimFingerprint != "" || persisted.RetentionMode != "ephemeral" || persisted.SubmissionOwner != "none" {
		t.Fatalf("migrated selection = %#v, want preserved legacy data with empty additive fields", persisted)
	}
}

func TestEnsureWorkspaceSchemaBackfillsLegacyAgentSelectionOwnership(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "legacy-selection-ownership.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite() error = %v", err)
	}
	if err := db.AutoMigrate(&domain.WorkspaceProjectModel{}, &legacyAgentSelectionModel{}); err != nil {
		t.Fatalf("creating legacy schema: %v", err)
	}
	now := domain.TimeFromString("2026-07-17T04:00:00Z")
	projectID := "project-legacy-ownership"
	if err := db.Create(&domain.WorkspaceProjectModel{ID: projectID, Name: "Legacy", Category: "drama", Status: "active", RelativeDir: projectID, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatalf("creating project: %v", err)
	}
	empty := ""
	fixtures := []legacyAgentSelectionModel{
		{ProjectID: projectID, ID: "legacy-generation-pending", SessionID: "session-legacy", RunID: "run-legacy", Kind: "generation_plan", Title: "Generation", OptionsJSON: "[]", Status: "pending", CreatedAt: now},
		{ProjectID: projectID, ID: "legacy-form-decided", SessionID: "session-legacy", RunID: "run-legacy", Kind: "form", Title: "Form", OptionsJSON: "[]", Status: "selected", CreatedAt: now, RetentionMode: &empty, SubmissionOwner: &empty},
	}
	for index := range fixtures {
		if err := db.Create(&fixtures[index]).Error; err != nil {
			t.Fatalf("creating legacy fixture %q: %v", fixtures[index].ID, err)
		}
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema() error = %v", err)
	}
	repo := NewAgentSelectionRepository(db)
	tests := []struct {
		id    string
		owner string
	}{
		{id: "legacy-generation-pending", owner: "agent_mcp"},
		{id: "legacy-form-decided", owner: "none"},
	}
	for _, tt := range tests {
		got, err := repo.GetAgentSelection(projectID, tt.id)
		if err != nil {
			t.Fatalf("GetAgentSelection(%q) error = %v", tt.id, err)
		}
		if got.RetentionMode != "ephemeral" || got.SubmissionOwner != tt.owner {
			t.Fatalf("selection %q retention/owner = %q/%q, want ephemeral/%q", tt.id, got.RetentionMode, got.SubmissionOwner, tt.owner)
		}
		var raw struct {
			RetentionMode   *string
			SubmissionOwner *string
		}
		if err := db.Raw("SELECT retention_mode, submission_owner FROM agent_selections WHERE project_id = ? AND id = ?", projectID, tt.id).Scan(&raw).Error; err != nil {
			t.Fatalf("reading physical ownership %q: %v", tt.id, err)
		}
		if raw.RetentionMode == nil || *raw.RetentionMode != "ephemeral" || raw.SubmissionOwner == nil || *raw.SubmissionOwner != tt.owner {
			t.Fatalf("physical selection %q = %#v, want non-null backfill", tt.id, raw)
		}
	}
	if err := db.Model(&domain.AgentSelectionModel{}).Where("project_id = ? AND id = ?", projectID, "legacy-form-decided").Updates(map[string]any{"retention_mode": "", "submission_owner": ""}).Error; err != nil {
		t.Fatalf("creating rolling-upgrade empty values: %v", err)
	}
	rolling, err := repo.GetAgentSelection(projectID, "legacy-form-decided")
	if err != nil || rolling.RetentionMode != "ephemeral" || rolling.SubmissionOwner != "none" {
		t.Fatalf("rolling reader selection = %#v, error=%v", rolling, err)
	}
}

func TestEnsureWorkspaceSchemaBackfillsAgentSelectionWhenOwnershipColumnsAreAbsent(t *testing.T) {
	db, err := OpenGormSQLite(filepath.Join(t.TempDir(), "legacy-selection-no-ownership.sqlite"))
	if err != nil {
		t.Fatalf("OpenGormSQLite() error = %v", err)
	}
	if err := db.AutoMigrate(&domain.WorkspaceProjectModel{}); err != nil {
		t.Fatalf("creating project schema: %v", err)
	}
	if err := db.Exec(`CREATE TABLE agent_selections (
		project_id TEXT NOT NULL DEFAULT '',
		id TEXT NOT NULL,
		session_id TEXT NOT NULL DEFAULT '',
		run_id TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		prompt TEXT NOT NULL DEFAULT '',
		options_json TEXT NOT NULL DEFAULT '[]',
		fields_json TEXT NOT NULL DEFAULT '',
		allow_custom NUMERIC NOT NULL DEFAULT false,
		status TEXT NOT NULL,
		decision_json TEXT NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL,
		decided_at DATETIME,
		expires_at DATETIME,
		PRIMARY KEY (project_id, id)
	)`).Error; err != nil {
		t.Fatalf("creating pre-ownership selection table: %v", err)
	}
	now := domain.TimeFromString("2026-07-17T04:30:00Z")
	projectID := "project-no-ownership-columns"
	if err := db.Create(&domain.WorkspaceProjectModel{ID: projectID, Name: "Legacy", Category: "drama", Status: "active", RelativeDir: projectID, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatalf("creating project: %v", err)
	}
	if err := db.Exec(`INSERT INTO agent_selections
		(project_id, id, session_id, run_id, kind, title, options_json, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		projectID, "legacy-generation-without-columns", "session-legacy", "run-legacy", "generation_plan", "Generation", "[]", "pending", now,
	).Error; err != nil {
		t.Fatalf("creating legacy generation selection: %v", err)
	}
	if err := EnsureWorkspaceSchema(db); err != nil {
		t.Fatalf("EnsureWorkspaceSchema() error = %v", err)
	}
	got, err := NewAgentSelectionRepository(db).GetAgentSelection(projectID, "legacy-generation-without-columns")
	if err != nil {
		t.Fatalf("GetAgentSelection() error = %v", err)
	}
	if got.RetentionMode != "ephemeral" || got.SubmissionOwner != "agent_mcp" || got.Status != "pending" {
		t.Fatalf("migrated selection = %#v", got)
	}
	var columns []struct {
		Name       string  `gorm:"column:name"`
		NotNull    int     `gorm:"column:notnull"`
		DefaultSQL *string `gorm:"column:dflt_value"`
	}
	if err := db.Raw("PRAGMA table_info(agent_selections)").Scan(&columns).Error; err != nil {
		t.Fatalf("reading agent selection schema: %v", err)
	}
	seen := map[string]bool{}
	for _, column := range columns {
		if column.Name == "retention_mode" || column.Name == "submission_owner" {
			seen[column.Name] = true
			if column.NotNull != 1 || column.DefaultSQL == nil {
				t.Fatalf("column %q notnull/default = %d/%v, want non-null default", column.Name, column.NotNull, column.DefaultSQL)
			}
		}
	}
	if !seen["retention_mode"] || !seen["submission_owner"] {
		t.Fatalf("ownership columns seen = %#v", seen)
	}
}
