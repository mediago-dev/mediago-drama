package pricing

import coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"

var routePrices = buildRoutePrices()

func buildRoutePrices() []RoutePrice {
	prices := []RoutePrice{}
	for _, route := range coregeneration.Routes() {
		price := RoutePrice{
			RouteID:  route.ID,
			Currency: "USD",
		}
		switch route.Kind {
		case coregeneration.KindText:
			price.Unit = UnitPerMillionTokens
			price.InputTokenPrice = 0.15
			price.OutputTokenPrice = 0.60
		case coregeneration.KindImage:
			price.Unit = UnitPerCall
			price.PerCallPrice = 0.02
		case coregeneration.KindVideo:
			price.Unit = UnitPerCall
			price.PerCallPrice = 0.20
		default:
			price.Unit = UnitPerCall
		}
		prices = append(prices, price)
	}
	return prices
}
