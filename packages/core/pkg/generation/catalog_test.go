package generation

import (
	"reflect"
	"testing"
)

func TestCatalogRoutesReferenceKnownFamiliesAndVersions(t *testing.T) {
	families := map[string]ModelFamily{}
	for _, family := range Families() {
		families[family.ID] = family
	}

	versions := map[string]ModelVersion{}
	for _, version := range Versions() {
		versions[version.ID] = version
	}

	providers := map[string]bool{}
	for _, route := range Routes() {
		family, ok := families[route.FamilyID]
		if !ok {
			t.Fatalf("route %q references unknown family %q", route.ID, route.FamilyID)
		}
		version, ok := versions[route.VersionID]
		if !ok {
			t.Fatalf("route %q references unknown version %q", route.ID, route.VersionID)
		}
		if version.FamilyID != route.FamilyID {
			t.Fatalf("route %q family = %q, version family = %q", route.ID, route.FamilyID, version.FamilyID)
		}
		if family.Kind != route.Kind || version.Kind != route.Kind {
			t.Fatalf("route %q kind mismatch", route.ID)
		}
		if route.Model == "" || route.DocURL == "" || route.Adapter == "" {
			t.Fatalf("route %q is missing execution metadata", route.ID)
		}
		providers[route.Provider] = true
	}

	for _, provider := range []string{
		ProviderOpenAI,
		ProviderGoogle,
		ProviderMiniMax,
		ProviderDeepSeek,
		ProviderVolcengine,
		ProviderAliyun,
		ProviderMediago,
		ProviderDMX,
		ProviderOpenRouter,
		ProviderJimeng,
		ProviderLibTV,
		ProviderXiaoyunque,
	} {
		if !providers[provider] {
			t.Fatalf("catalog does not expose provider %q", provider)
		}
	}
}

func TestTextCatalogIncludesExpandedRoutes(t *testing.T) {
	cases := []struct {
		id       string
		family   string
		provider string
		model    string
	}{
		{RouteDMXGPT55Text, FamilyGPTText, ProviderDMX, "gpt-5.5"},
		{RouteDMXGPT54Text, FamilyGPTText, ProviderDMX, "gpt-5.4"},
		{RouteDMXGPT54MiniText, FamilyGPTText, ProviderDMX, "gpt-5.4-mini"},
		{RouteMediagoGPT55Text, FamilyGPTText, ProviderMediago, "gpt-5.5"},
		{RouteMediagoGPT54Text, FamilyGPTText, ProviderMediago, "gpt-5.4"},
		{RouteMediagoGPT54MiniText, FamilyGPTText, ProviderMediago, "gpt-5.4-mini"},
		{RouteOpenRouterGPT55Text, FamilyGPTText, ProviderOpenRouter, "openai/gpt-5.5"},
		{RouteOpenRouterGPT54Text, FamilyGPTText, ProviderOpenRouter, "openai/gpt-5.4"},
		{RouteOpenRouterGPT54MiniText, FamilyGPTText, ProviderOpenRouter, "openai/gpt-5.4-mini"},
		{RouteDMXGemini35FlashText, FamilyGeminiText, ProviderDMX, "gemini-3.5-flash"},
		{RouteDMXGemini31ProText, FamilyGeminiText, ProviderDMX, "gemini-3.1-pro-preview"},
		{RouteDMXGemini31FlashLiteText, FamilyGeminiText, ProviderDMX, "gemini-3.1-flash-lite"},
		{RouteMediagoGemini35FlashText, FamilyGeminiText, ProviderMediago, "gemini-3.5-flash"},
		{RouteMediagoGemini31ProText, FamilyGeminiText, ProviderMediago, "gemini-3.1-pro-preview"},
		{RouteMediagoGemini31FlashLiteText, FamilyGeminiText, ProviderMediago, "gemini-3.1-flash-lite"},
		{RouteOpenRouterGemini35FlashText, FamilyGeminiText, ProviderOpenRouter, "google/gemini-3.5-flash"},
		{RouteOpenRouterGemini31ProText, FamilyGeminiText, ProviderOpenRouter, "google/gemini-3.1-pro-preview"},
		{RouteOpenRouterGemini31FlashLiteText, FamilyGeminiText, ProviderOpenRouter, "google/gemini-3.1-flash-lite"},
		{RouteDMXMiniMaxM3Text, FamilyMiniMaxText, ProviderDMX, "MiniMax-M3"},
		{RouteDMXMiniMaxM27Text, FamilyMiniMaxText, ProviderDMX, "MiniMax-M2.7"},
		{RouteDMXMiniMaxM27HighspeedText, FamilyMiniMaxText, ProviderDMX, "MiniMax-M2.7-highspeed"},
		{RouteMediagoMiniMaxM3Text, FamilyMiniMaxText, ProviderMediago, "MiniMax-M3"},
		{RouteMediagoMiniMaxM27Text, FamilyMiniMaxText, ProviderMediago, "MiniMax-M2.7"},
		{RouteMediagoMiniMaxM27HighspeedText, FamilyMiniMaxText, ProviderMediago, "MiniMax-M2.7-highspeed"},
		{RouteOpenRouterMiniMaxM3Text, FamilyMiniMaxText, ProviderOpenRouter, "minimax/minimax-m3"},
		{RouteOpenRouterMiniMaxM27Text, FamilyMiniMaxText, ProviderOpenRouter, "minimax/minimax-m2.7"},
		{RouteOpenRouterMiniMaxM27HighspeedText, FamilyMiniMaxText, ProviderOpenRouter, "minimax/minimax-m2.7-highspeed"},
		{RouteDMXDeepSeekV4FlashText, FamilyDeepSeekText, ProviderDMX, "deepseek-v4-flash"},
		{RouteDMXDeepSeekV4ProText, FamilyDeepSeekText, ProviderDMX, "deepseek-v4-pro"},
		{RouteMediagoDeepSeekV4FlashText, FamilyDeepSeekText, ProviderMediago, "deepseek-v4-flash"},
		{RouteMediagoDeepSeekV4ProText, FamilyDeepSeekText, ProviderMediago, "deepseek-v4-pro"},
		{RouteOpenRouterDeepSeekV4FlashText, FamilyDeepSeekText, ProviderOpenRouter, "deepseek/deepseek-v4-flash"},
		{RouteOpenRouterDeepSeekV4ProText, FamilyDeepSeekText, ProviderOpenRouter, "deepseek/deepseek-v4-pro"},
		{RouteOfficialGPT55Text, FamilyGPTText, ProviderOpenAI, "gpt-5.5"},
		{RouteOfficialGPT56SolText, FamilyGPTText, ProviderOpenAI, "gpt-5.6-sol"},
		{RouteOfficialGPT54Text, FamilyGPTText, ProviderOpenAI, "gpt-5.4"},
		{RouteOfficialGPT54MiniText, FamilyGPTText, ProviderOpenAI, "gpt-5.4-mini"},
		{RouteOfficialGemini35FlashText, FamilyGeminiText, ProviderGoogle, "gemini-3.5-flash"},
		{RouteOfficialGemini31ProText, FamilyGeminiText, ProviderGoogle, "gemini-3.1-pro-preview"},
		{RouteOfficialGemini31FlashLiteText, FamilyGeminiText, ProviderGoogle, "gemini-3.1-flash-lite"},
		{RouteOfficialMiniMaxM3Text, FamilyMiniMaxText, ProviderMiniMax, "MiniMax-M3"},
		{RouteOfficialMiniMaxM27Text, FamilyMiniMaxText, ProviderMiniMax, "MiniMax-M2.7"},
		{RouteOfficialMiniMaxM27HighspeedText, FamilyMiniMaxText, ProviderMiniMax, "MiniMax-M2.7-highspeed"},
		{RouteOfficialDeepSeekV4FlashText, FamilyDeepSeekText, ProviderDeepSeek, "deepseek-v4-flash"},
		{RouteOfficialDeepSeekV4ProText, FamilyDeepSeekText, ProviderDeepSeek, "deepseek-v4-pro"},
	}

	for _, tc := range cases {
		route, ok := FindRoute(tc.id)
		if !ok {
			t.Fatalf("route %q is missing", tc.id)
		}
		if route.Kind != KindText || route.FamilyID != tc.family {
			t.Fatalf("route %q = %#v, want text family route", tc.id, route)
		}
		if route.Provider != tc.provider || route.Model != tc.model {
			t.Fatalf("route %q provider/model = %q/%q, want %q/%q", tc.id, route.Provider, route.Model, tc.provider, tc.model)
		}
		if len(route.AuthKeys) != 1 || route.AuthKeys[0] != tc.provider {
			t.Fatalf("route %q auth keys = %#v, want provider key %q", tc.id, route.AuthKeys, tc.provider)
		}
		if tc.provider == ProviderMediago && route.Adapter != AdapterMediagoText {
			t.Fatalf("route %q adapter = %q, want %q", tc.id, route.Adapter, AdapterMediagoText)
		}
	}
}

func TestVideoCatalogIncludesOfficialHappyHorseRoute(t *testing.T) {
	for _, routeID := range []string{
		"official.happyhorse-1.1-i2v",
		"official.happyhorse-1.1-r2v",
		"official.happyhorse-1.1-t2v",
	} {
		if _, ok := FindRoute(routeID); ok {
			t.Fatalf("legacy HappyHorse route %q should not be exposed", routeID)
		}
	}

	route := mustRoute(t, RouteOfficialHappyHorse11)
	if route.Provider != ProviderAliyun || route.Model != ModelHappyHorse11 {
		t.Fatalf("provider/model = %q/%q", route.Provider, route.Model)
	}
	if !route.SupportsReferenceURLs || route.MaxReferenceURLs != 9 {
		t.Fatalf("references = %v/%d", route.SupportsReferenceURLs, route.MaxReferenceURLs)
	}
	if route.Adapter != AdapterOfficialAliyunHappyHorseVideo || !route.Async {
		t.Fatalf("adapter/async = %q/%v", route.Adapter, route.Async)
	}
	assertHasParams(t, route, "aspectRatio", "resolution", "duration")
	assertNoParams(t, route, "watermark", "seed")

	assertOptionValues(t, mustParam(t, route, "resolution"), []string{"720p", "1080p"})
	assertParamDefault(t, route, "resolution", "720p")
	assertParamDefault(t, route, "duration", "5")
	translated, err := TranslateRouteParams(route, map[string]any{
		"aspectRatio": "9:16",
		"resolution":  "1080p",
		"duration":    "6",
	})
	if err != nil {
		t.Fatalf("TranslateRouteParams() error = %v", err)
	}
	if translated["ratio"] != "9:16" || translated["resolution"] != "1080P" || translated["duration"] != "6" {
		t.Fatalf("translated params = %#v", translated)
	}

	versionCount := 0
	for _, version := range Catalog().Versions {
		if version.FamilyID != FamilyHappyHorse {
			continue
		}
		versionCount++
		if version.ID != VersionHappyHorse11 || version.Label != "HappyHorse 1.1" {
			t.Fatalf("HappyHorse version = %#v", version)
		}
	}
	if versionCount != 1 {
		t.Fatalf("HappyHorse version count = %d, want 1", versionCount)
	}
}

func TestVideoCatalogIncludesMediagoHappyHorseRoute(t *testing.T) {
	route := mustRoute(t, RouteMediagoHappyHorse11)
	if route.Provider != ProviderMediago || route.Model != ModelHappyHorse11T2V {
		t.Fatalf("provider/model = %q/%q", route.Provider, route.Model)
	}
	if route.Adapter != AdapterMediagoVideo || !route.Async {
		t.Fatalf("adapter/async = %q/%v", route.Adapter, route.Async)
	}
	if !route.SupportsReferenceURLs || route.MaxReferenceURLs != 9 {
		t.Fatalf("references = %v/%d", route.SupportsReferenceURLs, route.MaxReferenceURLs)
	}
	assertHasParams(t, route, "aspectRatio", "resolution", "duration")
	translated, err := TranslateRouteParams(route, map[string]any{
		"aspectRatio": "9:16",
		"resolution":  "1080p",
		"duration":    "6",
	})
	if err != nil {
		t.Fatalf("TranslateRouteParams() error = %v", err)
	}
	if translated["aspectRatio"] != "9:16" || translated["resolution"] != "1080p" || translated["duration"] != "6" {
		t.Fatalf("translated params = %#v", translated)
	}
}

func TestLibTVCatalogIncludesSeedanceRoutes(t *testing.T) {
	cases := []struct {
		id      string
		version string
		model   string
		hasHigh bool
		noHigh  bool
	}{
		{RouteLibTVSeedance20Fast, VersionSeedance20Fast, "Seedance 2.0 Fast VIP", false, true},
		{RouteLibTVSeedance20Mini, VersionSeedance20Mini, "Seedance 2.0 Mini", false, true},
		{RouteLibTVSeedance20, VersionSeedance20, "Seedance 2.0 VIP", true, false},
	}

	for _, tc := range cases {
		route, ok := FindRoute(tc.id)
		if !ok {
			t.Fatalf("route %q is missing", tc.id)
		}
		if route.Kind != KindVideo ||
			route.FamilyID != FamilySeedance ||
			route.VersionID != tc.version ||
			route.Provider != ProviderLibTV ||
			route.Adapter != AdapterLibTVCLIVideo {
			t.Fatalf("route %q = %#v, want LibTV video route", tc.id, route)
		}
		if route.Model != tc.model || !route.Async || !route.SupportsReferenceURLs || route.MaxReferenceURLs != 15 {
			t.Fatalf("route %q execution metadata = %#v", tc.id, route)
		}
		if len(route.AuthKeys) != 1 || route.AuthKeys[0] != ProviderLibTV {
			t.Fatalf("route %q auth keys = %#v, want LibTV key", tc.id, route.AuthKeys)
		}
		assertHasParams(t, route, "aspectRatio", "resolution", "duration", "generateAudio")
		resolution := mustParam(t, route, "resolution")
		assertHasOptions(t, resolution, "480p", "720p")
		if tc.hasHigh {
			assertHasOptions(t, resolution, "1080p", "4k")
		}
		if tc.noHigh {
			assertLacksOption(t, resolution, "1080p")
			assertLacksOption(t, resolution, "4k")
		}
	}

	route := mustRoute(t, RouteLibTVSeedance20Mini)
	params, err := NormalizeRouteParams(route, map[string]any{
		"aspectRatio":   "9:16",
		"resolution":    "720p",
		"duration":      "5",
		"generateAudio": false,
	})
	if err != nil {
		t.Fatalf("NormalizeRouteParams() error = %v", err)
	}
	translated, err := TranslateRouteParams(route, params)
	if err != nil {
		t.Fatalf("TranslateRouteParams() error = %v", err)
	}
	if !reflect.DeepEqual(translated, map[string]any{
		"ratio":       "9:16",
		"resolution":  "720p",
		"duration":    "5",
		"enableSound": false,
	}) {
		t.Fatalf("translated params = %#v", translated)
	}
}

func TestXiaoyunqueCatalogIncludesPippitSeedanceRoutes(t *testing.T) {
	cases := []struct {
		id       string
		version  string
		model    string
		has1080p bool
	}{
		{RouteXiaoyunqueSeedance20Fast, VersionSeedance20Fast, "seedance2.0_fast_vision", false},
		{RouteXiaoyunqueSeedance20Mini, VersionSeedance20Mini, "Seedance_2.0_mini", false},
		{RouteXiaoyunqueSeedance20, VersionSeedance20, "seedance2.0_vision", true},
		{RouteXiaoyunqueSeedance20MiniLite, VersionSeedance20MiniLite, "Seedance_2.0_mini_lite", false},
	}

	for _, tc := range cases {
		route, ok := FindRoute(tc.id)
		if !ok {
			t.Fatalf("route %q is missing", tc.id)
		}
		if route.Kind != KindVideo ||
			route.FamilyID != FamilySeedance ||
			route.VersionID != tc.version ||
			route.Provider != ProviderXiaoyunque ||
			route.Adapter != AdapterPippitCLIVideo {
			t.Fatalf("route %q = %#v, want Xiaoyunque Pippit video route", tc.id, route)
		}
		if route.Model != tc.model || !route.Async || !route.SupportsReferenceURLs {
			t.Fatalf("route %q execution metadata = %#v", tc.id, route)
		}
		if len(route.AuthKeys) != 1 || route.AuthKeys[0] != ProviderXiaoyunque {
			t.Fatalf("route %q auth keys = %#v, want Xiaoyunque key", tc.id, route.AuthKeys)
		}
		resolution := mustParam(t, route, "resolution")
		assertHasOptions(t, resolution, "720p")
		if tc.has1080p {
			assertHasOptions(t, resolution, "1080p")
		} else {
			assertLacksOption(t, resolution, "1080p")
		}
	}

	route := mustRoute(t, RouteXiaoyunqueSeedance20MiniLite)
	params, err := NormalizeRouteParams(route, map[string]any{
		"aspectRatio": "9:16",
		"resolution":  "720p",
		"duration":    "5",
	})
	if err != nil {
		t.Fatalf("NormalizeRouteParams() error = %v", err)
	}
	translated, err := TranslateRouteParams(route, params)
	if err != nil {
		t.Fatalf("TranslateRouteParams() error = %v", err)
	}
	if !reflect.DeepEqual(translated, map[string]any{
		"ratio":      "9:16",
		"resolution": "720p",
		"duration":   "5",
	}) {
		t.Fatalf("translated params = %#v", translated)
	}
}

func TestOfficialVolcengineSeedanceCatalogIncludesMiniAndStandard(t *testing.T) {
	cases := []struct {
		id      string
		version string
		model   string
	}{
		{RouteOfficialSeedance20Fast, VersionSeedance20Fast, "doubao-seedance-2-0-fast-260128"},
		{RouteOfficialSeedance20Mini, VersionSeedance20Mini, "doubao-seedance-2-0-mini-260615"},
		{RouteOfficialSeedance20, VersionSeedance20, "doubao-seedance-2-0-260128"},
	}

	for _, tc := range cases {
		route := mustRoute(t, tc.id)
		if route.Kind != KindVideo ||
			route.FamilyID != FamilySeedance ||
			route.VersionID != tc.version ||
			route.Provider != ProviderVolcengine ||
			route.Adapter != AdapterOfficialVolcengineVideo {
			t.Fatalf("route %q = %#v, want official Volcengine Seedance video route", tc.id, route)
		}
		if route.Model != tc.model || !route.Async || !route.SupportsReferenceURLs {
			t.Fatalf("route %q execution metadata = %#v", tc.id, route)
		}
		if len(route.AuthKeys) != 1 || route.AuthKeys[0] != ProviderVolcengine {
			t.Fatalf("route %q auth keys = %#v, want Volcengine key", tc.id, route.AuthKeys)
		}
		assertHasParams(t, route, "aspectRatio", "resolution", "duration", "generateAudio", "seed", "watermark", "returnLastFrame", "executionExpiresAfter", "negativePrompt")
	}

	for _, route := range Routes() {
		if route.Provider == ProviderVolcengine &&
			(route.VersionID == VersionSeedance20FastVIP || route.VersionID == VersionSeedance20VIP) {
			t.Fatalf("VIP Seedance route %q should not expose Volcengine official provider", route.ID)
		}
	}
}

func TestProviderRegistry(t *testing.T) {
	providers := map[string]ProviderInfo{}
	for _, provider := range Providers() {
		if provider.ID == "" || provider.Label == "" || provider.ProviderType == "" {
			t.Fatalf("provider has incomplete metadata: %#v", provider)
		}
		providers[provider.ID] = provider
	}

	for _, route := range Routes() {
		provider, ok := providers[route.Provider]
		if !ok {
			t.Fatalf("route %q references unknown provider %q", route.ID, route.Provider)
		}
		if got := ProviderTypeOf(route.Provider); got != provider.ProviderType {
			t.Fatalf("ProviderTypeOf(%q) = %q, want %q", route.Provider, got, provider.ProviderType)
		}
	}
}

func TestModelFamilyGroupsOwnTheirRoutes(t *testing.T) {
	for _, group := range ModelFamilyGroups() {
		if group.Family.ID == "" {
			t.Fatal("family group has no family id")
		}
		if len(group.Versions) == 0 {
			t.Fatalf("family %q has no versions", group.Family.ID)
		}
		if len(group.Routes) == 0 {
			t.Fatalf("family %q has no routes", group.Family.ID)
		}
		for _, version := range group.Versions {
			if version.FamilyID != group.Family.ID {
				t.Fatalf("version %q belongs to %q, want %q", version.ID, version.FamilyID, group.Family.ID)
			}
		}
		for _, route := range group.Routes {
			if route.FamilyID != group.Family.ID {
				t.Fatalf("route %q belongs to %q, want %q", route.ID, route.FamilyID, group.Family.ID)
			}
		}
	}
}

func TestCatalogAccessorsReturnIsolatedCopies(t *testing.T) {
	routes := Routes()
	if len(routes) == 0 || len(routes[0].Params) == 0 || len(routes[0].Params[0].Options) == 0 {
		t.Fatal("catalog route test requires params with options")
	}
	routeID := routes[0].ID
	paramName := routes[0].Params[0].Name
	optionValue := routes[0].Params[0].Options[0].Value
	routes[0].Params[0].Name = "mutated"
	routes[0].Params[0].Options[0].Value = "mutated"
	if len(routes[0].AuthKeys) > 0 {
		routes[0].AuthKeys[0] = "mutated"
	}

	route, ok := FindRoute(routeID)
	if !ok {
		t.Fatalf("FindRoute(%q) missing after mutation", routeID)
	}
	if route.Params[0].Name != paramName || route.Params[0].Options[0].Value != optionValue {
		t.Fatalf("FindRoute() returned mutated params: %#v", route.Params[0])
	}
	for _, authKey := range route.AuthKeys {
		if authKey == "mutated" {
			t.Fatalf("FindRoute() returned mutated auth keys: %#v", route.AuthKeys)
		}
	}

	models := Models()
	if len(models) == 0 || len(models[0].Params) == 0 {
		t.Fatal("catalog model test requires params")
	}
	modelID := models[0].ID
	modelParamName := models[0].Params[0].Name
	models[0].Params[0].Name = "mutated"
	model, ok := FindModel(modelID)
	if !ok {
		t.Fatalf("FindModel(%q) missing after mutation", modelID)
	}
	if model.Params[0].Name != modelParamName {
		t.Fatalf("FindModel() returned mutated params: %#v", model.Params[0])
	}
}

func TestModelFamilyGroupsReturnIsolatedCopies(t *testing.T) {
	groups := ModelFamilyGroups()
	if len(groups) == 0 || len(groups[0].Versions) == 0 || len(groups[0].Routes) == 0 {
		t.Fatal("family group copy test requires versions and routes")
	}
	familyID := groups[0].Family.ID
	versionID := groups[0].Versions[0].ID
	routeID := groups[0].Routes[0].ID
	groups[0].Family.ID = "mutated"
	groups[0].Versions[0].ID = "mutated"
	groups[0].Routes[0].ID = "mutated"

	nextGroups := ModelFamilyGroups()
	if nextGroups[0].Family.ID != familyID {
		t.Fatalf("ModelFamilyGroups() returned mutated family: %#v", nextGroups[0].Family)
	}
	if nextGroups[0].Versions[0].ID != versionID {
		t.Fatalf("ModelFamilyGroups() returned mutated version: %#v", nextGroups[0].Versions[0])
	}
	if nextGroups[0].Routes[0].ID != routeID {
		t.Fatalf("ModelFamilyGroups() returned mutated route: %#v", nextGroups[0].Routes[0])
	}
}

func TestDefaultRoutes(t *testing.T) {
	imageRoute, ok := DefaultRoute(KindImage)
	if !ok {
		t.Fatal("image default route is missing")
	}
	if imageRoute.ID != RouteWhereslowNanoBanana2 {
		t.Fatalf("image default route = %q, want %q", imageRoute.ID, RouteWhereslowNanoBanana2)
	}

	videoRoute, ok := DefaultRoute(KindVideo)
	if !ok {
		t.Fatal("video default route is missing")
	}
	if videoRoute.ID != RouteDMXSeedance20Fast {
		t.Fatalf("video default route = %q, want %q", videoRoute.ID, RouteDMXSeedance20Fast)
	}

	textRoute, ok := DefaultRoute(KindText)
	if !ok {
		t.Fatal("text default route is missing")
	}
	if textRoute.ID != RouteDMXGPT41MiniText {
		t.Fatalf("text default route = %q, want %q", textRoute.ID, RouteDMXGPT41MiniText)
	}

	audioRoute, ok := DefaultRoute(KindAudio)
	if !ok {
		t.Fatal("audio default route is missing")
	}
	if audioRoute.ID != RouteOfficialMiniMaxSpeech28HD {
		t.Fatalf("audio default route = %q, want %q", audioRoute.ID, RouteOfficialMiniMaxSpeech28HD)
	}
}

func TestVideoCatalogOnlyExposesKnownFamilies(t *testing.T) {
	videoFamilies := map[string]bool{
		FamilySeedance:   true,
		FamilyHappyHorse: true,
	}
	for _, family := range Families() {
		if family.Kind == KindVideo && !videoFamilies[family.ID] {
			t.Fatalf("unexpected video family %q", family.ID)
		}
	}

	for _, version := range Versions() {
		if version.Kind == KindVideo && !videoFamilies[version.FamilyID] {
			t.Fatalf("video version %q has unexpected family %q", version.ID, version.FamilyID)
		}
	}

	for _, route := range Routes() {
		if route.Kind == KindVideo && !videoFamilies[route.FamilyID] {
			t.Fatalf("video route %q has unexpected family %q", route.ID, route.FamilyID)
		}
	}
}

func TestValidateRouteParams(t *testing.T) {
	route := mustRoute(t, RouteWhereslowNanoBanana2)
	err := ValidateRouteParams(route, map[string]any{
		"aspectRatio": "not-a-ratio",
	})
	if err == nil {
		t.Fatal("ValidateRouteParams() accepted an invalid select option")
	}

	route = mustRoute(t, RouteDMXSeedance20Fast)
	err = ValidateRouteParams(route, map[string]any{
		"duration": 2,
	})
	if err == nil {
		t.Fatal("ValidateRouteParams() accepted an invalid seedance duration")
	}

	err = ValidateRouteParams(route, map[string]any{
		"duration": 10,
	})
	if err != nil {
		t.Fatalf("ValidateRouteParams() rejected a valid seedance duration: %v", err)
	}

	err = ValidateRouteParams(route, map[string]any{
		"negativePrompt": "ignored by this route",
	})
	if err != nil {
		t.Fatalf("ValidateRouteParams() rejected an unknown compatibility param: %v", err)
	}
}

func TestNormalizeRouteParams(t *testing.T) {
	route := mustRoute(t, RouteDMXSeedance20Fast)
	source := map[string]any{
		"duration":       "10",
		"generateAudio":  "false",
		"watermark":      "true",
		"negativePrompt": " kept for compatibility ",
	}

	normalized, err := NormalizeRouteParams(route, source)
	if err != nil {
		t.Fatalf("NormalizeRouteParams() error = %v", err)
	}
	if normalized["duration"] != "10" {
		t.Fatalf("duration = %#v, want string 10", normalized["duration"])
	}
	if normalized["generateAudio"] != false || normalized["watermark"] != true {
		t.Fatalf("booleans = generateAudio %#v watermark %#v", normalized["generateAudio"], normalized["watermark"])
	}
	if normalized["negativePrompt"] != " kept for compatibility " {
		t.Fatalf("unknown compatibility param changed: %#v", normalized["negativePrompt"])
	}
	if source["duration"] != "10" {
		t.Fatalf("NormalizeRouteParams() mutated source: %#v", source)
	}

}

func TestCredentialSpecsCoverRouteAuthKeys(t *testing.T) {
	specs := map[string]bool{}
	for _, spec := range CredentialSpecs() {
		specs[spec.ID] = true
	}

	for _, route := range Routes() {
		for _, authKey := range route.AuthKeys {
			if !specs[authKey] {
				t.Fatalf("route %q references unknown credential %q", route.ID, authKey)
			}
		}
	}
}

func mustRoute(t *testing.T, id string) ModelRoute {
	t.Helper()

	route, ok := FindRoute(id)
	if !ok {
		t.Fatalf("route %q is missing", id)
	}
	return route
}

func mustParam(t *testing.T, route ModelRoute, name string) ParamSpec {
	t.Helper()

	for _, param := range route.Params {
		if param.Name == name {
			return param
		}
	}
	t.Fatalf("route %q missing param %q", route.ID, name)
	return ParamSpec{}
}

func assertHasParams(t *testing.T, route ModelRoute, names ...string) {
	t.Helper()

	for _, name := range names {
		mustParam(t, route, name)
	}
}

func assertNoParams(t *testing.T, route ModelRoute, names ...string) {
	t.Helper()

	for _, name := range names {
		for _, param := range route.Params {
			if param.Name == name {
				t.Fatalf("route %q should not expose param %q", route.ID, name)
			}
		}
	}
}

func assertHasOptions(t *testing.T, param ParamSpec, values ...string) {
	t.Helper()

	options := map[string]bool{}
	for _, option := range param.Options {
		options[option.Value] = true
	}
	for _, value := range values {
		if !options[value] {
			t.Fatalf("param %q missing option %q", param.Name, value)
		}
	}
}

func assertLacksOption(t *testing.T, param ParamSpec, value string) {
	t.Helper()

	for _, option := range param.Options {
		if option.Value == value {
			t.Fatalf("param %q should not expose option %q", param.Name, value)
		}
	}
}

func assertOptionValues(t *testing.T, param ParamSpec, want []string) {
	t.Helper()

	got := make([]string, 0, len(param.Options))
	for _, option := range param.Options {
		got = append(got, option.Value)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("param %q options = %#v, want %#v", param.Name, got, want)
	}
}

func assertComboOutput(t *testing.T, route ModelRoute, firstParam, secondParam, key, want string) {
	t.Helper()

	for _, combo := range route.Combos {
		if len(combo.Params) == 2 && combo.Params[0] == firstParam && combo.Params[1] == secondParam {
			if got := combo.Outputs[key]; got != want {
				t.Fatalf("route %q combo output %q = %#v, want %#v", route.ID, key, got, want)
			}
			return
		}
	}
	t.Fatalf("route %q lacks combo for %s + %s", route.ID, firstParam, secondParam)
}

func assertParamDefault(t *testing.T, route ModelRoute, name string, want any) {
	t.Helper()

	param := mustParam(t, route, name)
	if !reflect.DeepEqual(param.Default, want) {
		t.Fatalf("route %q param %q default = %#v, want %#v", route.ID, name, param.Default, want)
	}
}
