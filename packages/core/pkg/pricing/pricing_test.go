package pricing

import (
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

type stubTable map[string]RoutePrice

func (table stubTable) Find(routeID string) (RoutePrice, bool) {
	price, ok := table[routeID]
	return price, ok
}

func TestOverlayJSONMergesPrices(t *testing.T) {
	base := NewTable([]RoutePrice{
		{
			RouteID:          "route-a",
			Currency:         "USD",
			Unit:             UnitPerMillionTokens,
			InputTokenPrice:  1,
			OutputTokenPrice: 2,
		},
	})

	table, err := OverlayJSON(base, strings.NewReader(`{
		"prices": [
			{"routeId":"route-a","currency":"CNY","unit":"per_call","perCallPrice":3},
			{"routeId":"route-b","currency":"USD","unit":"per_million_tokens","inputTokenPrice":4,"outputTokenPrice":5}
		]
	}`))
	if err != nil {
		t.Fatalf("OverlayJSON() error = %v", err)
	}

	updated, ok := table.Find("route-a")
	if !ok {
		t.Fatal("route-a missing")
	}
	if updated.Currency != "CNY" || updated.Unit != UnitPerCall || updated.PerCallPrice != 3 {
		t.Fatalf("route-a = %#v", updated)
	}
	added, ok := table.Find("route-b")
	if !ok {
		t.Fatal("route-b missing")
	}
	if added.InputTokenPrice != 4 || added.OutputTokenPrice != 5 {
		t.Fatalf("route-b = %#v", added)
	}
}

func TestOverlayJSONRejectsInvalidPrice(t *testing.T) {
	if _, err := OverlayJSON(Default(), strings.NewReader(`[{"routeId":"","currency":"USD","unit":"per_call"}]`)); err == nil {
		t.Fatal("OverlayJSON accepted a missing route id")
	}
	if _, err := OverlayJSON(Default(), strings.NewReader(`[{"routeId":"x","currency":"USD","unit":"credits"}]`)); err == nil {
		t.Fatal("OverlayJSON accepted an unsupported unit")
	}
}

func (table stubTable) List() []RoutePrice {
	values := make([]RoutePrice, 0, len(table))
	for _, value := range table {
		values = append(values, value)
	}
	return values
}

func TestEstimateCost(t *testing.T) {
	table := stubTable{
		"token.usd": {
			RouteID:          "token.usd",
			Currency:         "USD",
			Unit:             UnitPerMillionTokens,
			InputTokenPrice:  2,
			OutputTokenPrice: 8,
			CachedTokenPrice: 1,
		},
		"call.cny": {
			RouteID:      "call.cny",
			Currency:     "CNY",
			Unit:         UnitPerCall,
			PerCallPrice: 0.5,
		},
		"speech.usd": {
			RouteID:        "speech.usd",
			Currency:       "USD",
			Unit:           UnitPerMillionCharacters,
			CharacterPrice: 60,
		},
		"external.cny": {
			RouteID:  "external.cny",
			Currency: "CNY",
			Unit:     UnitExternal,
		},
	}

	tests := []struct {
		name      string
		routeID   string
		usage     Usage
		wantOK    bool
		wantCost  float64
		wantMoney string
	}{
		{
			name:      "million token pricing",
			routeID:   "token.usd",
			usage:     Usage{InputTokens: 1_000_000, OutputTokens: 500_000, CachedTokens: 250_000},
			wantOK:    true,
			wantCost:  6.25,
			wantMoney: "USD",
		},
		{
			name:      "per call pricing",
			routeID:   "call.cny",
			usage:     Usage{Calls: 3},
			wantOK:    true,
			wantCost:  1.5,
			wantMoney: "CNY",
		},
		{
			name:      "million character pricing",
			routeID:   "speech.usd",
			usage:     Usage{Characters: 500_000},
			wantOK:    true,
			wantCost:  30,
			wantMoney: "USD",
		},
		{
			name:    "missing route",
			routeID: "missing",
			usage:   Usage{Calls: 1},
			wantOK:  false,
		},
		{
			name:    "external route",
			routeID: "external.cny",
			usage:   Usage{InputTokens: 1_000_000, OutputTokens: 500_000, Calls: 1},
			wantOK:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cost, ok := EstimateCost(table, test.routeID, test.usage)
			if ok != test.wantOK {
				t.Fatalf("ok = %v, want %v", ok, test.wantOK)
			}
			if !ok {
				return
			}
			if cost.Currency != test.wantMoney {
				t.Fatalf("currency = %q, want %q", cost.Currency, test.wantMoney)
			}
			if cost.Amount != test.wantCost {
				t.Fatalf("amount = %v, want %v", cost.Amount, test.wantCost)
			}
		})
	}
}

func TestDefaultTableCoversCatalogRoutesAndReturnsCopies(t *testing.T) {
	table := Default()
	price, ok := table.Find(coregeneration.RouteDMXGPT41MiniText)
	if !ok {
		t.Fatalf("default price table misses %q", coregeneration.RouteDMXGPT41MiniText)
	}
	if price.Unit != UnitPerMillionTokens {
		t.Fatalf("text route unit = %q, want %q", price.Unit, UnitPerMillionTokens)
	}
	miniMaxHD, ok := table.Find(coregeneration.RouteOfficialMiniMaxSpeech28HD)
	if !ok {
		t.Fatalf("default price table misses %q", coregeneration.RouteOfficialMiniMaxSpeech28HD)
	}
	if miniMaxHD.Currency != "CNY" || miniMaxHD.Unit != UnitPerMillionCharacters || miniMaxHD.CharacterPrice != 350 {
		t.Fatalf("minimax hd price = %#v, want CNY 350 per million characters", miniMaxHD)
	}
	miniMaxTurbo, ok := table.Find(coregeneration.RouteOfficialMiniMaxSpeech28Turbo)
	if !ok {
		t.Fatalf("default price table misses %q", coregeneration.RouteOfficialMiniMaxSpeech28Turbo)
	}
	if miniMaxTurbo.Currency != "CNY" || miniMaxTurbo.Unit != UnitPerMillionCharacters || miniMaxTurbo.CharacterPrice != 200 {
		t.Fatalf("minimax turbo price = %#v, want CNY 200 per million characters", miniMaxTurbo)
	}

	list := table.List()
	if len(list) == 0 {
		t.Fatal("default price table is empty")
	}
	list[0].RouteID = "mutated"
	next := table.List()
	if next[0].RouteID == "mutated" {
		t.Fatal("List returned a mutable price slice")
	}
}
