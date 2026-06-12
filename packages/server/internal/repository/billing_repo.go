package repository

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// BillingRepository reads generation usage rows for billing rollups.
type BillingRepository struct {
	db *gorm.DB
}

// UsageQuery filters usage rows by created_at range and kind.
type UsageQuery struct {
	Start     string
	End       string
	Kind      string
	ProjectID string
}

// UsageBucketRow is one SQLite-aggregated usage bucket.
type UsageBucketRow struct {
	CapabilityID    string `gorm:"column:capability_id"`
	RouteID         string `gorm:"column:route_id"`
	FamilyID        string `gorm:"column:family_id"`
	VersionID       string `gorm:"column:version_id"`
	Provider        string `gorm:"column:provider"`
	ModelID         string `gorm:"column:model_id"`
	Model           string `gorm:"column:model"`
	Kind            string `gorm:"column:kind"`
	Bucket          string `gorm:"column:bucket"`
	Calls           int64  `gorm:"column:calls"`
	InputTokens     int64  `gorm:"column:input_tokens"`
	OutputTokens    int64  `gorm:"column:output_tokens"`
	TotalTokens     int64  `gorm:"column:total_tokens"`
	ReasoningTokens int64  `gorm:"column:reasoning_tokens"`
	CachedTokens    int64  `gorm:"column:cached_tokens"`
}

// NewBillingRepositoryFromDB creates a billing repository from a settings DB.
func NewBillingRepositoryFromDB(db *gorm.DB) *BillingRepository {
	return &BillingRepository{db: db}
}

// ListUsageBuckets returns route/day usage buckets aggregated by SQLite JSON functions.
func (repo *BillingRepository) ListUsageBuckets(query UsageQuery) ([]UsageBucketRow, error) {
	if repo == nil || repo.db == nil {
		return nil, fmt.Errorf("billing repository database is nil")
	}

	rows := []UsageBucketRow{}
	clauses := []string{
		"LOWER(TRIM(status)) IN ('completed', 'succeeded', 'success')",
		"TRIM(usage_json) <> ''",
		"json_valid(usage_json)",
	}
	args := []any{}
	if start := strings.TrimSpace(query.Start); start != "" {
		clauses = append(clauses, "created_at >= ?")
		args = append(args, start)
	}
	if end := strings.TrimSpace(query.End); end != "" {
		clauses = append(clauses, "created_at < ?")
		args = append(args, end)
	}
	if kind := strings.TrimSpace(query.Kind); kind != "" {
		clauses = append(clauses, "kind = ?")
		args = append(args, kind)
	}
	if projectID := strings.TrimSpace(query.ProjectID); projectID != "" {
		clauses = append(clauses, "project_id = ?")
		args = append(args, projectID)
	}

	sql := `
SELECT
	capability_id,
	route_id,
	family_id,
	version_id,
	provider,
	model_id,
	model,
	kind,
	SUBSTR(created_at, 1, 10) AS bucket,
	COUNT(*) AS calls,
	SUM(` + inputTokenExpr + `) AS input_tokens,
	SUM(` + outputTokenExpr + `) AS output_tokens,
	SUM(` + totalTokenForBillingExpr + `) AS total_tokens,
	SUM(` + reasoningTokenExpr + `) AS reasoning_tokens,
	SUM(` + cachedTokenExpr + `) AS cached_tokens
FROM generation_tasks
WHERE ` + strings.Join(clauses, " AND ") + `
GROUP BY capability_id, route_id, family_id, version_id, provider, model_id, model, kind, bucket
ORDER BY bucket ASC, route_id ASC`
	if err := repo.db.Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("listing billing usage buckets: %w", err)
	}
	return rows, nil
}

const (
	inputTokenExpr     = "COALESCE(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER), 0)"
	outputTokenExpr    = "COALESCE(CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER), 0)"
	totalTokenExpr     = "COALESCE(CAST(json_extract(usage_json, '$.totalTokens') AS INTEGER), 0)"
	reasoningTokenExpr = "COALESCE(CAST(json_extract(usage_json, '$.reasoningTokens') AS INTEGER), 0)"
	cachedTokenExpr    = "COALESCE(CAST(json_extract(usage_json, '$.cachedTokens') AS INTEGER), 0)"
)

const totalTokenForBillingExpr = "CASE WHEN " + totalTokenExpr + " > 0 THEN " + totalTokenExpr + " ELSE " + inputTokenExpr + " + " + outputTokenExpr + " END"
