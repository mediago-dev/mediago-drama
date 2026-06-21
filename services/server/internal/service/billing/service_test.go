package billing

import (
	"path/filepath"
	"testing"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
)

type priceTable map[string]corepricing.RoutePrice

func (table priceTable) Find(routeID string) (corepricing.RoutePrice, bool) {
	price, ok := table[routeID]
	return price, ok
}

func (table priceTable) List() []corepricing.RoutePrice {
	values := make([]corepricing.RoutePrice, 0, len(table))
	for _, value := range table {
		values = append(values, value)
	}
	return values
}

func TestSummaryGroupsCostsAndFlagsMissingPrices(t *testing.T) {
	repos := billingTestRepos(t)
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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

	service := NewService(repos.Billing, priceTable{
		"dmx.gpt-4.1-mini-text": {
			RouteID:          "dmx.gpt-4.1-mini-text",
			Currency:         "USD",
			Unit:             corepricing.UnitPerMillionTokens,
			InputTokenPrice:  2,
			OutputTokenPrice: 8,
		},
	}, corecapability.Default())
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
	if summary.Totals.Costs["USD"] != 6 {
		t.Fatalf("USD total = %v, want 6", summary.Totals.Costs["USD"])
	}
	if len(summary.Series) != 2 {
		t.Fatalf("series = %d, want 2", len(summary.Series))
	}
	custom := findBillingRow(t, summary.Rows, "missing.route")
	if custom.Priced {
		t.Fatal("missing.route row should be marked unpriced")
	}
}

func TestSummaryGroupsByCapability(t *testing.T) {
	repos := billingTestRepos(t)
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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

	service := NewService(repos.Billing, priceTable{
		"dmx.gpt-image-2": {
			RouteID:      "dmx.gpt-image-2",
			Currency:     "CNY",
			Unit:         corepricing.UnitPerCall,
			PerCallPrice: 0.5,
		},
	}, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{GroupBy: "capability"})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	row := findBillingRow(t, summary.Rows, "image.generate")
	if row.Calls != 1 || row.Costs["CNY"] != 0.5 {
		t.Fatalf("capability row = %#v", row)
	}
}

func TestSummaryGroupsByCapabilityPrefersStoredCapabilityID(t *testing.T) {
	repos := billingTestRepos(t)
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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

	service := NewService(repos.Billing, priceTable{
		"dmx.gpt-4.1-mini-text": {
			RouteID:         "dmx.gpt-4.1-mini-text",
			Currency:        "CNY",
			Unit:            corepricing.UnitPerMillionTokens,
			InputTokenPrice: 2,
		},
	}, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{GroupBy: "capability"})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	row := findBillingRow(t, summary.Rows, "novel.understand")
	if row.Label != "novel.understand" || row.Calls != 1 || row.Costs["CNY"] != 2 {
		t.Fatalf("capability row = %#v", row)
	}
}

func TestSummaryFiltersByProject(t *testing.T) {
	repos := billingTestRepos(t)
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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
	insertBillingTask(t, repos.DB, domain.GenerationTaskModel{
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

	service := NewService(repos.Billing, priceTable{
		"dmx.gpt-4.1-mini-text": {
			RouteID:          "dmx.gpt-4.1-mini-text",
			Currency:         "USD",
			Unit:             corepricing.UnitPerMillionTokens,
			InputTokenPrice:  2,
			OutputTokenPrice: 8,
		},
	}, corecapability.Default())
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
	if summary.Totals.Costs["USD"] != 6 {
		t.Fatalf("USD total = %v, want 6", summary.Totals.Costs["USD"])
	}
}

func billingTestRepos(t *testing.T) repository.WorkspaceRepositories {
	t.Helper()
	repos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	return repos
}

func insertBillingTask(t *testing.T, db *gorm.DB, task domain.GenerationTaskModel) {
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

func findBillingRow(t *testing.T, rows []SummaryRow, key string) SummaryRow {
	t.Helper()
	for _, row := range rows {
		if row.Key == key {
			return row
		}
	}
	t.Fatalf("row %q not found in %#v", key, rows)
	return SummaryRow{}
}
