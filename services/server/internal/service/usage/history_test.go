package usage

import (
	"encoding/json"
	"strings"
	"testing"

	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestHistoricalUsageHasNoPriceDependencyOrMoneyFields(t *testing.T) {
	repos := usageTestRepos(t)
	insertUsageTask(t, repos.DB, domain.GenerationTaskModel{
		ID: "historical-task", Provider: "mediago", RouteID: "mediago.retired-model",
		Model: "Retired model", Kind: "image", Status: "completed",
		InputTokens: 30, OutputTokens: 12, TotalTokens: 0, CachedTokens: 10,
		CreatedAt: domain.TimeFromString("2026-06-01T10:00:00Z"),
		UpdatedAt: domain.TimeFromString("2026-06-01T10:00:00Z"),
	})
	var before domain.GenerationTaskModel
	if err := repos.DB.First(&before, "id = ?", "historical-task").Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(repos.Usage, corecapability.Default())
	summary, err := service.Summary(SummaryRequest{GroupBy: "provider"})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.Calls != 1 || summary.Totals.TotalTokens != 42 || summary.Totals.CachedTokens != 10 {
		t.Fatalf("historical usage lost: %#v", summary.Totals)
	}
	payload, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"costs"`, `"currencies"`, `"priced"`, `"amount"`} {
		if strings.Contains(string(payload), field) {
			t.Fatalf("money field %s remains: %s", field, payload)
		}
	}
	var after domain.GenerationTaskModel
	if err := repos.DB.First(&after, "id = ?", "historical-task").Error; err != nil {
		t.Fatal(err)
	}
	if after.TotalTokens != before.TotalTokens || after.InputTokens != before.InputTokens || after.RouteID != before.RouteID {
		t.Fatal("usage aggregation rewrote a historical generation task")
	}
}
