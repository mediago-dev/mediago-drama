package billing

import (
	"fmt"
	"sort"
	"strings"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	corecapability "github.com/mediago-dev/mediago-drama/packages/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
)

// Service aggregates usage and estimates billing from generation task records.
type Service struct {
	repo   *repository.BillingRepository
	prices corepricing.Table
	caps   corecapability.Registry
}

// SummaryRequest filters and groups a billing summary.
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

// Totals reports aggregate calls, tokens, and costs.
type Totals struct {
	Calls           int64              `json:"calls"`
	InputTokens     int64              `json:"inputTokens"`
	OutputTokens    int64              `json:"outputTokens"`
	TotalTokens     int64              `json:"totalTokens"`
	ReasoningTokens int64              `json:"reasoningTokens"`
	CachedTokens    int64              `json:"cachedTokens"`
	Costs           map[string]float64 `json:"costs"`
}

// SummaryResponse is a grouped usage and billing summary.
type SummaryResponse struct {
	Range      RangeInfo     `json:"range"`
	Totals     Totals        `json:"totals"`
	Rows       []SummaryRow  `json:"rows"`
	Series     []SeriesPoint `json:"series"`
	Currencies []string      `json:"currencies"`
}

// SummaryRow is one grouped billing row.
type SummaryRow struct {
	Key             string             `json:"key"`
	Label           string             `json:"label"`
	Calls           int64              `json:"calls"`
	InputTokens     int64              `json:"inputTokens"`
	OutputTokens    int64              `json:"outputTokens"`
	TotalTokens     int64              `json:"totalTokens"`
	ReasoningTokens int64              `json:"reasoningTokens"`
	CachedTokens    int64              `json:"cachedTokens"`
	Costs           map[string]float64 `json:"costs"`
	Priced          bool               `json:"priced"`
}

// SeriesPoint is one daily usage point.
type SeriesPoint struct {
	Bucket       string             `json:"bucket"`
	Calls        int64              `json:"calls"`
	TotalTokens  int64              `json:"totalTokens"`
	CachedTokens int64              `json:"cachedTokens"`
	Costs        map[string]float64 `json:"costs"`
}

type groupBucket struct {
	SummaryRow
	missingPrice bool
}

type capabilityLookup struct {
	routeToCapability map[string]string
	labels            map[string]string
}

// NewService creates a billing aggregation service.
func NewService(repo *repository.BillingRepository, prices corepricing.Table, caps corecapability.Registry) *Service {
	return &Service{repo: repo, prices: prices, caps: caps}
}

// Summary returns a grouped billing summary.
func (service *Service) Summary(request SummaryRequest) (SummaryResponse, error) {
	if service == nil || service.repo == nil {
		return SummaryResponse{}, fmt.Errorf("billing service repository is nil")
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
	totals := Totals{Costs: map[string]float64{}}
	currencies := map[string]bool{}

	for _, row := range rows {
		groupKey, groupLabel := groupForRow(groupBy, row, caps)
		bucket := ensureGroup(groups, groupKey, groupLabel)
		addUsage(&bucket.SummaryRow, row)
		addTotals(&totals, row)

		point := ensureSeries(series, row.Bucket)
		point.Calls += row.Calls
		point.TotalTokens += row.TotalTokens
		point.CachedTokens += row.CachedTokens

		cost, priced := corepricing.EstimateCost(service.prices, row.RouteID, corepricing.Usage{
			InputTokens:  int(row.InputTokens),
			OutputTokens: int(row.OutputTokens),
			CachedTokens: int(row.CachedTokens),
			Calls:        int(row.Calls),
		})
		if !priced {
			bucket.missingPrice = true
			continue
		}
		addCost(bucket.Costs, cost.Currency, cost.Amount, currencies)
		addCost(totals.Costs, cost.Currency, cost.Amount, currencies)
		addCost(point.Costs, cost.Currency, cost.Amount, currencies)
	}

	responseRows := make([]SummaryRow, 0, len(groups))
	for _, bucket := range groups {
		bucket.Priced = !bucket.missingPrice
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
		Range:      RangeInfo{Start: request.Start, End: request.End},
		Totals:     totals,
		Rows:       responseRows,
		Series:     responseSeries,
		Currencies: sortedCurrencies(currencies),
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
		Key:    key,
		Label:  label,
		Costs:  map[string]float64{},
		Priced: true,
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
	point = &SeriesPoint{Bucket: bucket, Costs: map[string]float64{}}
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

func addCost(costs map[string]float64, currency string, amount float64, currencies map[string]bool) {
	if currency == "" {
		return
	}
	costs[currency] += amount
	currencies[currency] = true
}

func sortedCurrencies(values map[string]bool) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
