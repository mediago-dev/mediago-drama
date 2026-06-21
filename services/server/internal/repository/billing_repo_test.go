package repository

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

func TestBillingRepositoryListUsageBucketsAggregatesTokenColumns(t *testing.T) {
	repos, err := OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	ensureBillingProjectFixture(t, repos.DB, "project-a")
	ensureBillingProjectFixture(t, repos.DB, "project-b")

	tasks := []domain.GenerationTaskModel{
		{
			ID:              "task-1",
			ProjectID:       domain.StringPtr("project-a"),
			Kind:            "text",
			RouteID:         "dmx.gpt-4.1-mini-text",
			FamilyID:        "text",
			VersionID:       "gpt-4.1-mini-text",
			Provider:        "dmx",
			ModelID:         "gpt-4.1-mini-text",
			Model:           "gpt-4.1-mini",
			Prompt:          "hello",
			ParamsJSON:      "{}",
			Status:          "completed",
			Message:         "",
			InputTokens:     100,
			OutputTokens:    50,
			TotalTokens:     150,
			ReasoningTokens: 5,
			CachedTokens:    2,
			CreatedAt:       domain.TimeFromString("2026-06-01T00:00:00Z"),
			UpdatedAt:       domain.TimeFromString("2026-06-01T00:00:00Z"),
		},
		{
			ID:           "task-2",
			ProjectID:    domain.StringPtr("project-a"),
			Kind:         "text",
			RouteID:      "dmx.gpt-4.1-mini-text",
			FamilyID:     "text",
			VersionID:    "gpt-4.1-mini-text",
			Provider:     "dmx",
			ModelID:      "gpt-4.1-mini-text",
			Model:        "gpt-4.1-mini",
			Prompt:       "hello again",
			ParamsJSON:   "{}",
			Status:       "completed",
			Message:      "",
			InputTokens:  7,
			OutputTokens: 3,
			CreatedAt:    domain.TimeFromString("2026-06-01T08:00:00Z"),
			UpdatedAt:    domain.TimeFromString("2026-06-01T08:00:00Z"),
		},
		{
			ID:           "task-3",
			ProjectID:    domain.StringPtr("project-a"),
			Kind:         "text",
			RouteID:      "dmx.gpt-4.1-mini-text",
			FamilyID:     "text",
			VersionID:    "gpt-4.1-mini-text",
			Provider:     "dmx",
			ModelID:      "gpt-4.1-mini-text",
			Model:        "gpt-4.1-mini",
			Prompt:       "failed",
			ParamsJSON:   "{}",
			Status:       "failed",
			Message:      "",
			InputTokens:  1000,
			OutputTokens: 1000,
			TotalTokens:  2000,
			CreatedAt:    domain.TimeFromString("2026-06-01T09:00:00Z"),
			UpdatedAt:    domain.TimeFromString("2026-06-01T09:00:00Z"),
		},
		{
			ID:         "task-4",
			ProjectID:  domain.StringPtr("project-a"),
			Kind:       "text",
			RouteID:    "dmx.gpt-4.1-mini-text",
			FamilyID:   "text",
			VersionID:  "gpt-4.1-mini-text",
			Provider:   "dmx",
			ModelID:    "gpt-4.1-mini-text",
			Model:      "gpt-4.1-mini",
			Prompt:     "no usage",
			ParamsJSON: "{}",
			Status:     "completed",
			Message:    "",
			CreatedAt:  domain.TimeFromString("2026-06-01T09:30:00Z"),
			UpdatedAt:  domain.TimeFromString("2026-06-01T09:30:00Z"),
		},
		{
			ID:           "task-5",
			ProjectID:    domain.StringPtr("project-b"),
			Kind:         "text",
			RouteID:      "dmx.gpt-4.1-mini-text",
			FamilyID:     "text",
			VersionID:    "gpt-4.1-mini-text",
			Provider:     "dmx",
			ModelID:      "gpt-4.1-mini-text",
			Model:        "gpt-4.1-mini",
			Prompt:       "other project",
			ParamsJSON:   "{}",
			Status:       "completed",
			Message:      "",
			InputTokens:  1000,
			OutputTokens: 1000,
			TotalTokens:  2000,
			CreatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
			UpdatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
		},
	}
	for _, task := range tasks {
		if err := repos.DB.Create(&task).Error; err != nil {
			t.Fatalf("creating task %q: %v", task.ID, err)
		}
	}

	rows, err := repos.Billing.ListUsageBuckets(UsageQuery{
		Start:     "2026-06-01T00:00:00Z",
		End:       "2026-06-02T00:00:00Z",
		Kind:      "text",
		ProjectID: "project-a",
	})
	if err != nil {
		t.Fatalf("ListUsageTasks() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].RouteID != "dmx.gpt-4.1-mini-text" ||
		rows[0].Bucket != "2026-06-01" ||
		rows[0].Calls != 3 ||
		rows[0].InputTokens != 107 ||
		rows[0].OutputTokens != 53 ||
		rows[0].TotalTokens != 160 ||
		rows[0].ReasoningTokens != 5 ||
		rows[0].CachedTokens != 2 {
		t.Fatalf("row = %#v", rows[0])
	}
}

func ensureBillingProjectFixture(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	now := domain.TimeFromString("2026-06-01T00:00:00Z")
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          id,
		Name:        id,
		Category:    "drama",
		Status:      "active",
		RelativeDir: id,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture %q: %v", id, err)
	}
}
