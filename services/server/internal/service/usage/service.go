package usage

import (
	"fmt"
	"sort"
	"strings"

	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

// Service aggregates usage from generation task records.
type Service struct {
	repo *repository.UsageRepository
	caps corecapability.Registry
}

// SummaryRequest filters and groups a usage summary.
type SummaryRequest struct {
	Start     string
	End       string
	GroupBy   string
	Kind      string
	ProjectID string
}

// RangeInfo reports the inclusive/exclusive created_at range used for a summary.
type RangeInfo struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// Totals reports aggregate calls and tokens.
type Totals struct {
	Calls           int64 `json:"calls"`
	InputTokens     int64 `json:"inputTokens"`
	OutputTokens    int64 `json:"outputTokens"`
	TotalTokens     int64 `json:"totalTokens"`
	ReasoningTokens int64 `json:"reasoningTokens"`
	CachedTokens    int64 `json:"cachedTokens"`
}

// SummaryResponse is a grouped usage summary.
type SummaryResponse struct {
	Range  RangeInfo     `json:"range"`
	Totals Totals        `json:"totals"`
	Rows   []SummaryRow  `json:"rows"`
	Series []SeriesPoint `json:"series"`
}

// SummaryRow is one grouped usage row.
type SummaryRow struct {
	Key             string `json:"key"`
	Label           string `json:"label"`
	Calls           int64  `json:"calls"`
	InputTokens     int64  `json:"inputTokens"`
	OutputTokens    int64  `json:"outputTokens"`
	TotalTokens     int64  `json:"totalTokens"`
	ReasoningTokens int64  `json:"reasoningTokens"`
	CachedTokens    int64  `json:"cachedTokens"`
}

// SeriesPoint is one daily usage point.
type SeriesPoint struct {
	Bucket       string `json:"bucket"`
	Calls        int64  `json:"calls"`
	TotalTokens  int64  `json:"totalTokens"`
	CachedTokens int64  `json:"cachedTokens"`
}

type groupBucket struct {
	SummaryRow
}

type capabilityLookup struct {
	routeToCapability map[string]string
	labels            map[string]string
}

// NewService creates a usage aggregation service.
func NewService(repo *repository.UsageRepository, caps corecapability.Registry) *Service {
	return &Service{repo: repo, caps: caps}
}

// Summary returns a grouped usage summary.
func (service *Service) Summary(request SummaryRequest) (SummaryResponse, error) {
	if service == nil || service.repo == nil {
		return SummaryResponse{}, fmt.Errorf("usage service repository is nil")
	}
	groupBy := normalizeGroupBy(request.GroupBy)
	rows, err := service.repo.ListUsageBuckets(repository.UsageQuery{
		Start:     request.Start,
		End:       request.End,
		Kind:      request.Kind,
		ProjectID: request.ProjectID,
	})
	if err != nil {
		return SummaryResponse{}, err
	}

	caps := service.capabilityLookup()
	groups := map[string]*groupBucket{}
	series := map[string]*SeriesPoint{}
	totals := Totals{}

	for _, row := range rows {
		groupKey, groupLabel := groupForRow(groupBy, row, caps)
		bucket := ensureGroup(groups, groupKey, groupLabel)
		addUsage(&bucket.SummaryRow, row)
		addTotals(&totals, row)

		point := ensureSeries(series, row.Bucket)
		point.Calls += row.Calls
		point.TotalTokens += row.TotalTokens
		point.CachedTokens += row.CachedTokens

	}

	responseRows := make([]SummaryRow, 0, len(groups))
	for _, bucket := range groups {
		responseRows = append(responseRows, bucket.SummaryRow)
	}
	sort.Slice(responseRows, func(i int, j int) bool {
		if responseRows[i].TotalTokens == responseRows[j].TotalTokens {
			return responseRows[i].Key < responseRows[j].Key
		}
		return responseRows[i].TotalTokens > responseRows[j].TotalTokens
	})

	responseSeries := make([]SeriesPoint, 0, len(series))
	for _, point := range series {
		responseSeries = append(responseSeries, *point)
	}
	sort.Slice(responseSeries, func(i int, j int) bool {
		return responseSeries[i].Bucket < responseSeries[j].Bucket
	})

	return SummaryResponse{
		Range:  RangeInfo{Start: request.Start, End: request.End},
		Totals: totals,
		Rows:   responseRows,
		Series: responseSeries,
	}, nil
}

func normalizeGroupBy(value string) string {
	switch strings.TrimSpace(value) {
	case "capability", "kind", "provider":
		return strings.TrimSpace(value)
	default:
		return "model"
	}
}

func (service *Service) capabilityLookup() capabilityLookup {
	lookup := capabilityLookup{
		routeToCapability: map[string]string{},
		labels:            map[string]string{},
	}
	if service == nil || service.caps == nil {
		return lookup
	}
	for _, cap := range service.caps.List() {
		lookup.labels[cap.ID] = cap.Name
		for _, routeID := range cap.RelatedRoutes {
			if _, exists := lookup.routeToCapability[routeID]; !exists {
				lookup.routeToCapability[routeID] = cap.ID
			}
		}
	}
	return lookup
}

func groupForRow(groupBy string, row repository.UsageBucketRow, caps capabilityLookup) (string, string) {
	switch groupBy {
	case "capability":
		if capabilityID := strings.TrimSpace(row.CapabilityID); capabilityID != "" {
			label := caps.labels[capabilityID]
			if label == "" {
				label = capabilityID
			}
			return capabilityID, label
		}
		if capabilityID := caps.routeToCapability[row.RouteID]; capabilityID != "" {
			label := caps.labels[capabilityID]
			if label == "" {
				label = capabilityID
			}
			return capabilityID, label
		}
		// Older records keep their media kind after a provider route is retired.
		if capabilityID := row.Kind + ".generate"; caps.labels[capabilityID] != "" {
			return capabilityID, caps.labels[capabilityID]
		}
		return "unassigned", "未归类能力"
	case "kind":
		if row.Kind == "" {
			return "unknown", "未知类型"
		}
		return row.Kind, row.Kind
	case "provider":
		if row.Provider == "" {
			return "unknown", "未知供应商"
		}
		return row.Provider, row.Provider
	default:
		key := row.RouteID
		if key == "" {
			key = row.ModelID
		}
		if key == "" {
			key = row.Model
		}
		if key == "" {
			key = "unknown"
		}
		label := row.Model
		if label == "" {
			label = row.ModelID
		}
		if label == "" {
			label = key
		}
		return key, label
	}
}

func ensureGroup(groups map[string]*groupBucket, key string, label string) *groupBucket {
	bucket := groups[key]
	if bucket != nil {
		return bucket
	}
	bucket = &groupBucket{SummaryRow: SummaryRow{
		Key:   key,
		Label: label,
	}}
	groups[key] = bucket
	return bucket
}

func ensureSeries(series map[string]*SeriesPoint, bucket string) *SeriesPoint {
	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		bucket = "unknown"
	}
	point := series[bucket]
	if point != nil {
		return point
	}
	point = &SeriesPoint{Bucket: bucket}
	series[bucket] = point
	return point
}

func addUsage(row *SummaryRow, bucket repository.UsageBucketRow) {
	row.Calls += bucket.Calls
	row.InputTokens += bucket.InputTokens
	row.OutputTokens += bucket.OutputTokens
	row.TotalTokens += bucket.TotalTokens
	row.ReasoningTokens += bucket.ReasoningTokens
	row.CachedTokens += bucket.CachedTokens
}

func addTotals(totals *Totals, bucket repository.UsageBucketRow) {
	totals.Calls += bucket.Calls
	totals.InputTokens += bucket.InputTokens
	totals.OutputTokens += bucket.OutputTokens
	totals.TotalTokens += bucket.TotalTokens
	totals.ReasoningTokens += bucket.ReasoningTokens
	totals.CachedTokens += bucket.CachedTokens
}
