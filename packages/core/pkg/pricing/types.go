package pricing

// Unit names how a price is metered.
type Unit string

const (
	// UnitPerMillionTokens prices input and output tokens per million.
	UnitPerMillionTokens Unit = "per_million_tokens"
	// UnitPerCall prices each generation call.
	UnitPerCall Unit = "per_call"
)

// RoutePrice is the price record for one generation route.
type RoutePrice struct {
	RouteID          string  `json:"routeId"`
	Currency         string  `json:"currency"`
	Unit             Unit    `json:"unit"`
	InputTokenPrice  float64 `json:"inputTokenPrice"`
	OutputTokenPrice float64 `json:"outputTokenPrice"`
	CachedTokenPrice float64 `json:"cachedTokenPrice,omitempty"`
	PerCallPrice     float64 `json:"perCallPrice,omitempty"`
}

// Usage is the metered usage to be priced.
type Usage struct {
	InputTokens  int
	OutputTokens int
	CachedTokens int
	Calls        int
}

// Cost is the computed monetary estimate.
type Cost struct {
	RouteID  string  `json:"routeId"`
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// Table resolves prices by route id. Reads return deep copies.
type Table interface {
	Find(routeID string) (RoutePrice, bool)
	List() []RoutePrice
}
