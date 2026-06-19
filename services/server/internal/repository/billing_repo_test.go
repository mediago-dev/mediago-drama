package repository

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestBillingRepositoryListUsageBucketsAggregatesJSONUsage(t *testing.T) {
	repos, err := OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}

	tasks := []domain.GenerationTaskModel{
		{
			ID:                    "task-1",
			ProjectID:             "project-a",
			Kind:                  "text",
			RouteID:               "dmx.gpt-4.1-mini-text",
			FamilyID:              "text",
			VersionID:             "gpt-4.1-mini-text",
			Provider:              "dmx",
			ModelID:               "gpt-4.1-mini-text",
			Model:                 "gpt-4.1-mini",
			Prompt:                "hello",
			ReferenceURLsJSON:     "[]",
			ReferenceAssetIDsJSON: "[]",
			ParamsJSON:            "{}",
			Status:                "completed",
			Message:               "",
			AssetsJSON:            "[]",
			UsageJSON:             `{"inputTokens":100,"outputTokens":50,"totalTokens":150,"reasoningTokens":5,"cachedTokens":2}`,
			CreatedAt:             "2026-06-01T00:00:00Z",
			UpdatedAt:             "2026-06-01T00:00:00Z",
		},
		{
			ID:                    "task-2",
			ProjectID:             "project-a",
			Kind:                  "text",
			RouteID:               "dmx.gpt-4.1-mini-text",
			FamilyID:              "text",
			VersionID:             "gpt-4.1-mini-text",
			Provider:              "dmx",
			ModelID:               "gpt-4.1-mini-text",
			Model:                 "gpt-4.1-mini",
			Prompt:                "hello again",
			ReferenceURLsJSON:     "[]",
			ReferenceAssetIDsJSON: "[]",
			ParamsJSON:            "{}",
			Status:                "completed",
			Message:               "",
			AssetsJSON:            "[]",
			UsageJSON:             `{"inputTokens":7,"outputTokens":3}`,
			CreatedAt:             "2026-06-01T08:00:00Z",
			UpdatedAt:             "2026-06-01T08:00:00Z",
		},
		{
			ID:                    "task-3",
			ProjectID:             "project-a",
			Kind:                  "text",
			RouteID:               "dmx.gpt-4.1-mini-text",
			FamilyID:              "text",
			VersionID:             "gpt-4.1-mini-text",
			Provider:              "dmx",
			ModelID:               "gpt-4.1-mini-text",
			Model:                 "gpt-4.1-mini",
			Prompt:                "failed",
			ReferenceURLsJSON:     "[]",
			ReferenceAssetIDsJSON: "[]",
			ParamsJSON:            "{}",
			Status:                "failed",
			Message:               "",
			AssetsJSON:            "[]",
			UsageJSON:             `{"inputTokens":1000,"outputTokens":1000,"totalTokens":2000}`,
			CreatedAt:             "2026-06-01T09:00:00Z",
			UpdatedAt:             "2026-06-01T09:00:00Z",
		},
		{
			ID:                    "task-4",
			ProjectID:             "project-a",
			Kind:                  "text",
			RouteID:               "dmx.gpt-4.1-mini-text",
			FamilyID:              "text",
			VersionID:             "gpt-4.1-mini-text",
			Provider:              "dmx",
			ModelID:               "gpt-4.1-mini-text",
			Model:                 "gpt-4.1-mini",
			Prompt:                "invalid",
			ReferenceURLsJSON:     "[]",
			ReferenceAssetIDsJSON: "[]",
			ParamsJSON:            "{}",
			Status:                "completed",
			Message:               "",
			AssetsJSON:            "[]",
			UsageJSON:             `not-json`,
			CreatedAt:             "2026-06-01T09:30:00Z",
			UpdatedAt:             "2026-06-01T09:30:00Z",
		},
		{
			ID:                    "task-5",
			ProjectID:             "project-b",
			Kind:                  "text",
			RouteID:               "dmx.gpt-4.1-mini-text",
			FamilyID:              "text",
			VersionID:             "gpt-4.1-mini-text",
			Provider:              "dmx",
			ModelID:               "gpt-4.1-mini-text",
			Model:                 "gpt-4.1-mini",
			Prompt:                "other project",
			ReferenceURLsJSON:     "[]",
			ReferenceAssetIDsJSON: "[]",
			ParamsJSON:            "{}",
			Status:                "completed",
			Message:               "",
			AssetsJSON:            "[]",
			UsageJSON:             `{"inputTokens":1000,"outputTokens":1000,"totalTokens":2000}`,
			CreatedAt:             "2026-06-01T10:00:00Z",
			UpdatedAt:             "2026-06-01T10:00:00Z",
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
		rows[0].Calls != 2 ||
		rows[0].InputTokens != 107 ||
		rows[0].OutputTokens != 53 ||
		rows[0].TotalTokens != 160 ||
		rows[0].ReasoningTokens != 5 ||
		rows[0].CachedTokens != 2 {
		t.Fatalf("row = %#v", rows[0])
	}
}
