package pricing

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type staticTable struct {
	index priceIndex
}

type overlayDocument struct {
	Prices []RoutePrice `json:"prices"`
}

// NewTable returns an immutable price table from explicit route prices.
func NewTable(prices []RoutePrice) Table {
	return staticTable{index: buildPriceIndexFromPrices(prices)}
}

func (table staticTable) Find(routeID string) (RoutePrice, bool) {
	price, ok := table.index.byID[routeID]
	return price, ok
}

func (table staticTable) List() []RoutePrice {
	return cloneRoutePrices(table.index.prices)
}

// OverlayJSON merges JSON route price overrides onto a base table.
func OverlayJSON(base Table, reader io.Reader) (Table, error) {
	if base == nil {
		base = Default()
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("reading pricing overlay: %w", err)
	}
	prices, err := decodeOverlayPrices(raw)
	if err != nil {
		return nil, err
	}
	merged := base.List()
	positions := make(map[string]int, len(merged))
	for index, price := range merged {
		positions[price.RouteID] = index
	}
	for _, price := range prices {
		if err := validateRoutePrice(price); err != nil {
			return nil, err
		}
		if index, ok := positions[price.RouteID]; ok {
			merged[index] = price
			continue
		}
		positions[price.RouteID] = len(merged)
		merged = append(merged, price)
	}
	return NewTable(merged), nil
}

func decodeOverlayPrices(raw []byte) ([]RoutePrice, error) {
	var document overlayDocument
	if err := json.Unmarshal(raw, &document); err == nil && document.Prices != nil {
		return document.Prices, nil
	}
	var prices []RoutePrice
	if err := json.Unmarshal(raw, &prices); err != nil {
		return nil, fmt.Errorf("parsing pricing overlay: %w", err)
	}
	return prices, nil
}

func validateRoutePrice(price RoutePrice) error {
	if strings.TrimSpace(price.RouteID) == "" {
		return fmt.Errorf("pricing overlay route id is required")
	}
	if strings.TrimSpace(price.Currency) == "" {
		return fmt.Errorf("pricing overlay %q currency is required", price.RouteID)
	}
	switch price.Unit {
	case UnitPerMillionTokens, UnitPerMillionCharacters, UnitPerCall:
		return nil
	default:
		return fmt.Errorf("pricing overlay %q has unsupported unit %q", price.RouteID, price.Unit)
	}
}
