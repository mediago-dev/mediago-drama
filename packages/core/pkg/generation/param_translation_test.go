package generation

import (
	"reflect"
	"testing"
)

func TestTranslateRouteParamsMovesAndValues(t *testing.T) {
	route := mustRoute(t, RouteJimengSeedream50)
	request := Request{
		Kind:    KindImage,
		RouteID: route.ID,
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "4K",
			"poll":        45,
		},
	}
	if err := ValidateRequestForRoute(request, route); err != nil {
		t.Fatalf("ValidateRequestForRoute() error = %v", err)
	}

	resolved := ApplyRoute(request, route)
	if !resolved.ParamsResolved {
		t.Fatal("ApplyRoute() did not mark params resolved")
	}
	if got, want := resolved.Params["ratio"], "16:9"; got != want {
		t.Fatalf("ratio = %#v, want %#v", got, want)
	}
	if got, want := resolved.Params["resolutionType"], "4k"; got != want {
		t.Fatalf("resolutionType = %#v, want %#v", got, want)
	}
	if got, want := resolved.Params["poll"], 45; got != want {
		t.Fatalf("compat poll = %#v, want %#v", got, want)
	}
	if _, ok := resolved.Params["aspectRatio"]; ok {
		t.Fatalf("canonical aspectRatio leaked after translation: %#v", resolved.Params)
	}
	if _, ok := resolved.Params["resolution"]; ok {
		t.Fatalf("canonical resolution leaked after translation: %#v", resolved.Params)
	}

	again := ApplyRoute(resolved, route)
	if !reflect.DeepEqual(again.Params, resolved.Params) {
		t.Fatalf("ApplyRoute() translated twice: %#v -> %#v", resolved.Params, again.Params)
	}
	if err := ValidateRequestForRoute(again, route); err != nil {
		t.Fatalf("ValidateRequestForRoute() rejected resolved vendor params: %v", err)
	}
}

func TestTranslateRouteParamsJoinsWithRouteDefaults(t *testing.T) {
	route := mustRoute(t, RouteDMXSeedream5Lite)
	resolved := ApplyRoute(Request{
		Kind:    KindImage,
		RouteID: route.ID,
		Params: map[string]any{
			"aspectRatio": "16:9",
		},
	}, route)

	if got, want := resolved.Params["size"], "2848x1600"; got != want {
		t.Fatalf("size = %#v, want %#v", got, want)
	}
	if _, ok := resolved.Params["aspectRatio"]; ok {
		t.Fatalf("aspectRatio leaked after join: %#v", resolved.Params)
	}
	if _, ok := resolved.Params["resolution"]; ok {
		t.Fatalf("resolution leaked after join: %#v", resolved.Params)
	}
}

func TestTranslateRouteParamsJoinsSeedreamAdaptiveSize(t *testing.T) {
	route := mustRoute(t, RouteDMXSeedream5Lite)
	resolved := ApplyRoute(Request{
		Kind:    KindImage,
		RouteID: route.ID,
		Params: map[string]any{
			"aspectRatio": "adaptive",
			"resolution":  "2K",
		},
	}, route)

	if got, want := resolved.Params["size"], "2K"; got != want {
		t.Fatalf("size = %#v, want %#v", got, want)
	}
}

func TestTranslateRouteParamsJoinsGPTImageSize(t *testing.T) {
	route := mustRoute(t, RouteDMXGPTImage2)

	tests := []struct {
		name   string
		params map[string]any
		want   string
	}{
		{
			name: "square 1k",
			params: map[string]any{
				"aspectRatio": "1:1",
				"resolution":  "1K",
			},
			want: "1024x1024",
		},
		{
			name: "adaptive",
			params: map[string]any{
				"aspectRatio": "adaptive",
				"resolution":  "1K",
			},
			want: "auto",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resolved := ApplyRoute(Request{
				Kind:    KindImage,
				RouteID: route.ID,
				Params:  test.params,
			}, route)

			if got := resolved.Params["size"]; got != test.want {
				t.Fatalf("size = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestTranslateRouteParamsRejectsUnavailableGPTImageCombo(t *testing.T) {
	route := mustRoute(t, RouteDMXGPTImage2)
	request := Request{
		Kind:    KindImage,
		RouteID: route.ID,
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "1K",
		},
	}

	if err := ValidateRequestForRoute(request, route); err == nil {
		t.Fatal("ValidateRequestForRoute() accepted unavailable gpt-image size combo")
	}
}

func TestTranslateRouteParamsPassesThroughLegacyVendorParams(t *testing.T) {
	route := mustRoute(t, RouteJimengSeedream50)
	request := Request{
		Kind:    KindImage,
		RouteID: route.ID,
		Params: map[string]any{
			"ratio":          "1:1",
			"resolutionType": "2k",
		},
	}
	if err := ValidateRequestForRoute(request, route); err != nil {
		t.Fatalf("ValidateRequestForRoute() rejected legacy params: %v", err)
	}

	resolved := ApplyRoute(request, route)
	if got, want := resolved.Params["ratio"], "1:1"; got != want {
		t.Fatalf("ratio = %#v, want %#v", got, want)
	}
	if got, want := resolved.Params["resolutionType"], "2k"; got != want {
		t.Fatalf("resolutionType = %#v, want %#v", got, want)
	}
}

func TestUpgradeLegacyRouteParams(t *testing.T) {
	tests := []struct {
		name   string
		route  string
		params map[string]any
		want   map[string]any
	}{
		{
			name:  "jimeng image aliases",
			route: RouteJimengSeedream50,
			params: map[string]any{
				"ratio":          "9:16",
				"resolutionType": "4k",
			},
			want: map[string]any{
				"aspectRatio": "9:16",
				"resolution":  "4K",
			},
		},
		{
			name:  "jimeng video aliases",
			route: RouteJimengSeedance20Fast,
			params: map[string]any{
				"ratio":           "16:9",
				"videoResolution": "720p",
			},
			want: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "720p",
			},
		},
		{
			name:  "imageSize alias",
			route: RouteDMXNanoBanana31,
			params: map[string]any{
				"aspectRatio": "16:9",
				"imageSize":   "2K",
			},
			want: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "2K",
			},
		},
		{
			name:  "seedream joined size",
			route: RouteDMXSeedream5Lite,
			params: map[string]any{
				"size": "1600x2848",
			},
			want: map[string]any{
				"aspectRatio": "9:16",
				"resolution":  "2K",
			},
		},
		{
			name:  "seedream legacy named size",
			route: RouteDMXSeedream5Lite,
			params: map[string]any{
				"size": "2K",
			},
			want: map[string]any{
				"aspectRatio": "adaptive",
				"resolution":  "2K",
			},
		},
		{
			name:  "seedream exact square size",
			route: RouteDMXSeedream5Lite,
			params: map[string]any{
				"size": "2048x2048",
			},
			want: map[string]any{
				"aspectRatio": "1:1",
				"resolution":  "2K",
			},
		},
		{
			name:  "gpt image auto size",
			route: RouteDMXGPTImage2,
			params: map[string]any{
				"size": "auto",
			},
			want: map[string]any{
				"aspectRatio": "adaptive",
				"resolution":  "1K",
			},
		},
		{
			name:  "gpt image wide size",
			route: RouteDMXGPTImage2,
			params: map[string]any{
				"size": "2048x1152",
			},
			want: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "2K",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			route := mustRoute(t, test.route)
			got, err := UpgradeLegacyRouteParams(route, test.params)
			if err != nil {
				t.Fatalf("UpgradeLegacyRouteParams() error = %v", err)
			}
			for key, want := range test.want {
				if got[key] != want {
					t.Fatalf("%s = %#v, want %#v in %#v", key, got[key], want, got)
				}
			}
			for key := range test.params {
				if _, keep := test.want[key]; !keep {
					if _, exists := got[key]; exists {
						t.Fatalf("legacy key %q was not removed: %#v", key, got)
					}
				}
			}
		})
	}
}

func TestUpgradeLegacyRouteParamsTranslatesSameNameMoveValues(t *testing.T) {
	route := ModelRoute{
		ID:   "test.same-name-move",
		Kind: KindImage,
		Params: routeParamSpecs(KindImage, []RouteParam{
			selectRouteParam(ParamResolution, "2K", []ParamOption{
				{Label: "2K", Value: "2K"},
				{Label: "4K", Value: "4K"},
			}),
		}),
		CanonicalParams: []RouteParam{
			selectRouteParam(ParamResolution, "2K", []ParamOption{
				{Label: "2K", Value: "2K"},
				{Label: "4K", Value: "4K"},
			}),
		},
		Translation: ParamTranslation{
			Moves: []ParamMove{
				{From: ParamResolution, Values: map[string]string{"2K": "2k", "4K": "4k"}},
			},
		},
		Status: RouteStatusAvailable,
	}

	upgraded, err := UpgradeLegacyRouteParams(route, map[string]any{"resolution": "2k"})
	if err != nil {
		t.Fatalf("UpgradeLegacyRouteParams() error = %v", err)
	}
	if upgraded["resolution"] != "2K" {
		t.Fatalf("resolution = %#v, want 2K", upgraded["resolution"])
	}

	upgraded, err = UpgradeLegacyRouteParams(route, map[string]any{"resolution": "2K"})
	if err != nil {
		t.Fatalf("UpgradeLegacyRouteParams() idempotent error = %v", err)
	}
	if upgraded["resolution"] != "2K" {
		t.Fatalf("idempotent resolution = %#v, want 2K", upgraded["resolution"])
	}
}
