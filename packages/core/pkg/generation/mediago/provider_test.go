package mediago

import "testing"

func TestSuppressOpenAIProviderOptionsOnlyForMediaGo(t *testing.T) {
	tests := []struct {
		name         string
		providerName string
		want         bool
	}{
		{name: "mediago", providerName: Provider, want: true},
		{name: "openrouter", providerName: "openrouter", want: false},
		{name: "dmx", providerName: "dmx", want: false},
		{name: "empty", providerName: "", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := SuppressOpenAIProviderOptions(test.providerName); got != test.want {
				t.Fatalf("SuppressOpenAIProviderOptions(%q) = %v, want %v", test.providerName, got, test.want)
			}
		})
	}
}

func TestOmitChatImageSizeOnlyForMediaGoGemini25Image(t *testing.T) {
	tests := []struct {
		name         string
		providerName string
		model        string
		want         bool
	}{
		{
			name:         "mediago gemini 2.5 image",
			providerName: Provider,
			model:        "gemini-2.5-flash-image",
			want:         true,
		},
		{
			name:         "mediago gemini 2.5 image with whitespace and case",
			providerName: Provider,
			model:        " Gemini-2.5-Flash-Image ",
			want:         true,
		},
		{
			name:         "mediago gemini 3.1 image keeps size",
			providerName: Provider,
			model:        "gemini-3.1-flash-image",
			want:         false,
		},
		{
			name:         "openrouter gemini 2.5 image keeps size",
			providerName: "openrouter",
			model:        "gemini-2.5-flash-image",
			want:         false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := OmitChatImageSize(test.providerName, test.model); got != test.want {
				t.Fatalf("OmitChatImageSize(%q, %q) = %v, want %v", test.providerName, test.model, got, test.want)
			}
		})
	}
}

func TestRoutesForFamilyReturnsProviderOwnedSpecs(t *testing.T) {
	tests := []struct {
		name       string
		familyID   string
		wantRoutes []string
		wantKind   string
	}{
		{
			name:       "nano banana image routes",
			familyID:   familyNanoBanana,
			wantRoutes: []string{RouteNanoBanana31, RouteNanoBananaPro, RouteNanoBanana25},
			wantKind:   kindImage,
		},
		{
			name:       "gpt text routes",
			familyID:   familyGPTText,
			wantRoutes: []string{RouteGPT41MiniText, RouteGPT5MiniText, RouteGPT55Text, RouteGPT54Text, RouteGPT54MiniText},
			wantKind:   kindText,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			routes := RoutesForFamily(test.familyID)
			if len(routes) != len(test.wantRoutes) {
				t.Fatalf("route count = %d, want %d", len(routes), len(test.wantRoutes))
			}

			byID := make(map[string]bool, len(routes))
			for _, route := range routes {
				byID[route.ID] = true
				if route.FamilyID != test.familyID {
					t.Fatalf("route %q family = %q, want %q", route.ID, route.FamilyID, test.familyID)
				}
				if route.Kind != test.wantKind {
					t.Fatalf("route %q kind = %q, want %q", route.ID, route.Kind, test.wantKind)
				}
				if route.Label != "MediaGo" {
					t.Fatalf("route %q label = %q, want MediaGo", route.ID, route.Label)
				}
				if route.Model == "" || route.Adapter == "" || route.DocURL == "" {
					t.Fatalf("route %q should include model, adapter and docs: %#v", route.ID, route)
				}
			}

			for _, routeID := range test.wantRoutes {
				if !byID[routeID] {
					t.Fatalf("missing route %q in %#v", routeID, routes)
				}
			}
		})
	}
}
