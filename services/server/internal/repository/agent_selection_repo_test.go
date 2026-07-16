package repository

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

type legacyAgentSelectionModel struct {
	ProjectID    string     `gorm:"column:project_id;primaryKey;default:''"`
	ID           string     `gorm:"column:id;primaryKey"`
	SessionID    string     `gorm:"column:session_id;not null;default:''"`
	RunID        string     `gorm:"column:run_id;not null;default:''"`
	Kind         string     `gorm:"column:kind;not null;default:''"`
	Title        string     `gorm:"column:title;not null;default:''"`
	Prompt       string     `gorm:"column:prompt;not null;default:''"`
	OptionsJSON  string     `gorm:"column:options_json;not null;default:'[]'"`
	FieldsJSON   string     `gorm:"column:fields_json;not null;default:''"`
	AllowCustom  bool       `gorm:"column:allow_custom;not null;default:false"`
	Status       string     `gorm:"column:status;not null"`
	DecisionJSON string     `gorm:"column:decision_json;not null;default:''"`
	CreatedAt    time.Time  `gorm:"column:created_at;not null"`
	DecidedAt    *time.Time `gorm:"column:decided_at"`
	ExpiresAt    *time.Time `gorm:"column:expires_at"`
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
	if persisted.Title != legacy.Title || persisted.SessionID != legacy.SessionID || persisted.IntentJSON != "" || persisted.GenerationClaimFingerprint != "" {
		t.Fatalf("migrated selection = %#v, want preserved legacy data with empty additive fields", persisted)
	}
}
