package pricing

type defaultTable struct{}

type priceIndex struct {
	prices []RoutePrice
	byID   map[string]RoutePrice
}

var defaultPriceIndex = buildPriceIndex()

// Default returns the process-wide built-in price table.
func Default() Table {
	return defaultTable{}
}

func (defaultTable) Find(routeID string) (RoutePrice, bool) {
	price, ok := defaultPriceIndex.byID[routeID]
	return price, ok
}

func (defaultTable) List() []RoutePrice {
	return cloneRoutePrices(defaultPriceIndex.prices)
}

// EstimateCost prices usage under a route. ok is false when routeID has no price.
func EstimateCost(table Table, routeID string, usage Usage) (Cost, bool) {
	if table == nil {
		return Cost{}, false
	}
	price, ok := table.Find(routeID)
	if !ok {
		return Cost{}, false
	}

	amount := 0.0
	switch price.Unit {
	case UnitPerMillionTokens:
		amount += float64(usage.InputTokens) * price.InputTokenPrice / 1_000_000
		amount += float64(usage.OutputTokens) * price.OutputTokenPrice / 1_000_000
		amount += float64(usage.CachedTokens) * price.CachedTokenPrice / 1_000_000
	case UnitPerMillionCharacters:
		characters := usage.Characters
		if characters == 0 {
			characters = usage.InputTokens
		}
		amount += float64(characters) * price.CharacterPrice / 1_000_000
	case UnitPerCall:
		amount += float64(usage.Calls) * price.PerCallPrice
	case UnitExternal:
		return Cost{}, false
	}

	return Cost{RouteID: routeID, Currency: price.Currency, Amount: amount}, true
}

func buildPriceIndex() priceIndex {
	return buildPriceIndexFromPrices(routePrices)
}

func buildPriceIndexFromPrices(prices []RoutePrice) priceIndex {
	byID := make(map[string]RoutePrice, len(prices))
	for _, price := range prices {
		byID[price.RouteID] = price
	}
	return priceIndex{prices: cloneRoutePrices(prices), byID: byID}
}

func cloneRoutePrices(values []RoutePrice) []RoutePrice {
	result := make([]RoutePrice, len(values))
	copy(result, values)
	return result
}
