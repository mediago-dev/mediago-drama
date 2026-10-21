package usage

import (
	"path/filepath"
	"testing"

	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
)

func TestSummaryIncludesRetiredAndUnknownRoutes(t *testing.T) {
	repos := usageTestRepos(t)
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:              "task-1",
		Kind:            "text",
		RouteID:         "dmx.gpt-4.1-mini-text",
		FamilyID:        "text",
		VersionID:       "gpt-4.1-mini-text",
		Provider:        "dmx",
		ModelID:         "gpt-4.1-mini-text",
		Model:           "gpt-4.1-mini",
		Status:          "completed",
		InputTokens:     1000000,
		OutputTokens:    500000,
		TotalTokens:     1500000,
		ReasoningTokens: 125000,
		CachedTokens:    250000,
		CreatedAt:       domain.TimeFromString("2026-06-01T10:00:00Z"),
		UpdatedAt:       domain.TimeFromString("2026-06-01T10:00:00Z"),
	})
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:           "task-2",
		Kind:         "text",
		RouteID:      "missing.route",
		FamilyID:     "text",
		VersionID:    "unknown",
		Provider:     "custom",
		ModelID:      "custom-model",
		Model:        "custom-model",
		Status:       "completed",
		InputTokens:  100,
		OutputTokens: 50,
		TotalTokens:  150,
		CreatedAt:    domain.TimeFromString("2026-06-02T10:00:00Z"),
		UpdatedAt:    domain.TimeFromString("2026-06-02T10:00:00Z"),
	})
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:           "task-3",
		Kind:         "text",
		RouteID:      "dmx.gpt-4.1-mini-text",
		FamilyID:     "text",
		VersionID:    "gpt-4.1-mini-text",
		Provider:     "dmx",
		ModelID:      "gpt-4.1-mini-text",
		Model:        "gpt-4.1-mini",
		Status:       "failed",
		InputTokens:  1000000,
		OutputTokens: 1000000,
		TotalTokens:  2000000,
		CreatedAt:    domain.TimeFromString("2026-06-03T10:00:00Z"),
		UpdatedAt:    domain.TimeFromString("2026-06-03T10:00:00Z"),
	})

	service := NewService(repos.Usage, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{
		Start:   "2026-06-01T00:00:00Z",
		End:     "2026-06-04T00:00:00Z",
		GroupBy: "model",
	})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if summary.Totals.Calls != 2 || summary.Totals.TotalTokens != 1500150 || summary.Totals.CachedTokens != 250000 || summary.Totals.ReasoningTokens != 125000 {
		t.Fatalf("totals = %#v", summary.Totals)
	}
	if len(summary.Series) != 2 {
		t.Fatalf("series = %d, want 2", len(summary.Series))
	}
	custom := findUsageRow(t, summary.Rows, "missing.route")
	if custom.Calls != 1 || custom.TotalTokens != 150 {
		t.Fatalf("unknown route lost usage: %#v", custom)
	}
}

func TestSummaryGroupsByCapability(t *testing.T) {
	repos := usageTestRepos(t)
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:          "task-1",
		Kind:        "image",
		RouteID:     "dmx.gpt-image-2",
		FamilyID:    "gpt-image",
		VersionID:   "gpt-image-2",
		Provider:    "dmx",
		ModelID:     "gpt-image-2",
		Model:       "gpt-image-2",
		Status:      "completed",
		InputTokens: 1,
		TotalTokens: 1,
		CreatedAt:   domain.TimeFromString("2026-06-01T10:00:00Z"),
		UpdatedAt:   domain.TimeFromString("2026-06-01T10:00:00Z"),
	})

	service := NewService(repos.Usage, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{GroupBy: "capability"})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	row := findUsageRow(t, summary.Rows, "image.generate")
	if row.Calls != 1 {
		t.Fatalf("capability row = %#v", row)
	}
}

func TestSummaryGroupsByCapabilityPrefersStoredCapabilityID(t *testing.T) {
	repos := usageTestRepos(t)
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:           "task-1",
		CapabilityID: domain.StringPtr("novel.understand"),
		Kind:         "text",
		RouteID:      "dmx.gpt-4.1-mini-text",
		FamilyID:     "text",
		VersionID:    "gpt-4.1-mini-text",
		Provider:     "dmx",
		ModelID:      "gpt-4.1-mini-text",
		Model:        "gpt-4.1-mini",
		Status:       "completed",
		InputTokens:  1000000,
		TotalTokens:  1000000,
		CreatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
		UpdatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
	})

	service := NewService(repos.Usage, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{GroupBy: "capability"})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	row := findUsageRow(t, summary.Rows, "novel.understand")
	if row.Label != "novel.understand" || row.Calls != 1 {
		t.Fatalf("capability row = %#v", row)
	}
}

func TestSummaryFiltersByProject(t *testing.T) {
	repos := usageTestRepos(t)
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:           "task-1",
		ProjectID:    domain.StringPtr("project-a"),
		Kind:         "text",
		RouteID:      "dmx.gpt-4.1-mini-text",
		FamilyID:     "text",
		VersionID:    "gpt-4.1-mini-text",
		Provider:     "dmx",
		ModelID:      "gpt-4.1-mini-text",
		Model:        "gpt-4.1-mini",
		Status:       "completed",
		InputTokens:  1000000,
		OutputTokens: 500000,
		TotalTokens:  1500000,
		CreatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
		UpdatedAt:    domain.TimeFromString("2026-06-01T10:00:00Z"),
	})
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID:           "task-2",
		ProjectID:    domain.StringPtr("project-b"),
		Kind:         "text",
		RouteID:      "dmx.gpt-4.1-mini-text",
		FamilyID:     "text",
		VersionID:    "gpt-4.1-mini-text",
		Provider:     "dmx",
		ModelID:      "gpt-4.1-mini-text",
		Model:        "gpt-4.1-mini",
		Status:       "completed",
		InputTokens:  2000000,
		OutputTokens: 1000000,
		TotalTokens:  3000000,
		CreatedAt:    domain.TimeFromString("2026-06-01T11:00:00Z"),
		UpdatedAt:    domain.TimeFromString("2026-06-01T11:00:00Z"),
	})

	service := NewService(repos.Usage, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{
		GroupBy:   "model",
		ProjectID: "project-a",
	})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if summary.Totals.Calls != 1 || summary.Totals.TotalTokens != 1500000 {
		t.Fatalf("totals = %#v", summary.Totals)
	}
}

func usageTestRepos(t *testing.T) repository.WorkspaceRepositories {
	t.Helper()
	repos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	sqlDB, err := repos.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	})
	return repos
}

func insertUsageTask(t *testing.T, db *gorm.DB, task domain.GenerationTaskModel) {
	t.Helper()
	task.Prompt = "prompt"
	task.ParamsJSON = "{}"
	task.Message = ""
	if projectID := domain.StringValue(task.ProjectID); projectID != "" {
		project := domain.WorkspaceProjectModel{
			ID:          projectID,
			Name:        projectID,
			Category:    "drama",
			Status:      "active",
			RelativeDir: projectID,
			CreatedAt:   domain.TimeFromString("2026-06-01T00:00:00Z"),
			UpdatedAt:   domain.TimeFromString("2026-06-01T00:00:00Z"),
		}
		if err := db.Where("id = ?", projectID).FirstOrCreate(&project).Error; err != nil {
			t.Fatalf("creating project fixture %q: %v", projectID, err)
		}
	}
	if task.CreatedAt.IsZero() {
		task.CreatedAt = domain.TimeFromString("2026-06-01T00:00:00Z")
	}
	if task.UpdatedAt.IsZero() {
		task.UpdatedAt = task.CreatedAt
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("creating task %q: %v", task.ID, err)
	}
}

func findUsageRow(t *testing.T, rows []SummaryRow, key string) SummaryRow {
	t.Helper()
	for _, row := range rows {
		if row.Key == key {
			return row
		}
	}
	t.Fatalf("row %q not found in %#v", key, rows)
	return SummaryRow{}
}
