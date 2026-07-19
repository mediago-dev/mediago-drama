package generation

import (
	"reflect"
	"strings"
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
	}
}

func TestImageCatalogIncludesMediagoRoutes(t *testing.T) {
	cases := []struct {
		id           string
		family       string
		version      string
		model        string
		adapter      string
		refs         bool
		status       RouteStatus
		reasonPrefix string
	}{
		{RouteMediagoSeedream5Lite, FamilySeedream, VersionSeedream5Lite, "doubao-seedream-5-0-lite", AdapterOpenRouterChatImage, false, RouteStatusAvailable, ""},
		{RouteMediagoGPTImage2, FamilyGPTImage, VersionGPTImage2, "gpt-image-2", AdapterOpenRouterImages, true, RouteStatusAvailable, ""},
		{RouteMediagoNanoBanana31, FamilyNanoBanana, VersionNanoBanana31, "gemini-3.1-flash-image", AdapterOpenRouterChatImage, true, RouteStatusAvailable, ""},
		{RouteMediagoNanoBananaPro, FamilyNanoBanana, VersionNanoBananaPro, "gemini-3-pro-image", AdapterOpenRouterChatImage, true, RouteStatusAvailable, ""},
		{RouteMediagoNanoBanana25, FamilyNanoBanana, VersionNanoBanana25, "gemini-2.5-flash-image", AdapterOpenRouterChatImage, true, RouteStatusAvailable, ""},
	}

	for _, tc := range cases {
		route, ok := FindRoute(tc.id)
		if !ok {
			t.Fatalf("route %q is missing", tc.id)
		}
		if route.Kind != KindImage || route.FamilyID != tc.family || route.VersionID != tc.version {
			t.Fatalf("route %q = %#v, want image family/version route", tc.id, route)
		}
		if route.Provider != ProviderMediago || route.Model != tc.model {
			t.Fatalf("route %q provider/model = %q/%q, want %q/%q", tc.id, route.Provider, route.Model, ProviderMediago, tc.model)
		}
		if len(route.AuthKeys) != 1 || route.AuthKeys[0] != ProviderMediago {
			t.Fatalf("route %q auth keys = %#v, want MediaGo key", tc.id, route.AuthKeys)
		}
		if route.Adapter != tc.adapter {
			t.Fatalf("route %q adapter = %q, want %q", tc.id, route.Adapter, tc.adapter)
		}
		if route.SupportsReferenceURLs != tc.refs {
			t.Fatalf("route %q refs = %v, want %v", tc.id, route.SupportsReferenceURLs, tc.refs)
		}
		if route.Status != tc.status {
			t.Fatalf("route %q status = %q, want %q", tc.id, route.Status, tc.status)
		}
		if tc.reasonPrefix != "" && !strings.HasPrefix(route.StatusReason, tc.reasonPrefix) {
			t.Fatalf("route %q status reason = %q, want prefix %q", tc.id, route.StatusReason, tc.reasonPrefix)
		}
	}
}

func TestImageCatalogIncludesOfficialGoogleNanoBanana25(t *testing.T) {
	route, ok := FindRoute(RouteOfficialNanoBanana25)
	if !ok {
		t.Fatalf("route %q is missing", RouteOfficialNanoBanana25)
	}
	if route.Kind != KindImage || route.FamilyID != FamilyNanoBanana || route.VersionID != VersionNanoBanana25 {
		t.Fatalf("route %q = %#v, want Nano Banana 2.5 image route", RouteOfficialNanoBanana25, route)
	}
	if route.Provider != ProviderGoogle || route.Model != "gemini-2.5-flash-image" {
		t.Fatalf("route %q provider/model = %q/%q, want %q/gemini-2.5-flash-image", route.ID, route.Provider, route.Model, ProviderGoogle)
	}
	if route.Adapter != AdapterOfficialGoogleImage {
		t.Fatalf("route %q adapter = %q, want %q", route.ID, route.Adapter, AdapterOfficialGoogleImage)
	}
	if len(route.AuthKeys) != 1 || route.AuthKeys[0] != ProviderGoogle {
		t.Fatalf("route %q auth keys = %#v, want Google key", route.ID, route.AuthKeys)
	}
	if !route.SupportsReferenceURLs {
		t.Fatal("official Gemini 2.5 Flash Image route should support reference images")
	}
	assertHasOptions(t, mustParam(t, route, "resolution"), "1K")
	assertHasOptions(t, mustParam(t, route, "aspectRatio"), "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
	assertLacksOption(t, mustParam(t, route, "aspectRatio"), "1:4")
	assertLacksOption(t, mustParam(t, route, "aspectRatio"), "1:8")
	assertLacksOption(t, mustParam(t, route, "aspectRatio"), "4:1")
	assertLacksOption(t, mustParam(t, route, "aspectRatio"), "8:1")
	assertLacksOption(t, mustParam(t, route, "aspectRatio"), "9:21")
	assertLacksOption(t, mustParam(t, route, "resolution"), "2K")
	assertLacksOption(t, mustParam(t, route, "resolution"), "4K")
	assertComboOutput(t, route, "aspectRatio", "resolution", "1:1|1K", "1024x1024")
	assertComboOutput(t, route, "aspectRatio", "resolution", "16:9|1K", "1344x768")
}

func TestImageCatalogIncludesOfficialWan27Routes(t *testing.T) {
	pro := mustRoute(t, RouteOfficialWan27ImagePro)
	if pro.Provider != ProviderAliyun || pro.Model != ModelWan27ImagePro {
		t.Fatalf("pro provider/model = %q/%q, want %q/%q", pro.Provider, pro.Model, ProviderAliyun, ModelWan27ImagePro)
	}
	if pro.Adapter != AdapterOfficialAliyunWanImage || pro.MaxReferenceURLs != 9 {
		t.Fatalf("pro adapter/max refs = %q/%d", pro.Adapter, pro.MaxReferenceURLs)
	}
	assertHasParams(t, pro, "aspectRatio", "resolution", "n")
	assertNoParams(t, pro, "watermark", "seed")
	assertOptionValues(t, mustParam(t, pro, "aspectRatio"), []string{"1:1", "16:9", "9:16", "4:3", "3:4"})
	assertOptionValues(t, mustParam(t, pro, "resolution"), []string{"1K", "2K", "4K"})
	assertParamDefault(t, pro, "resolution", "2K")
	assertComboOutput(t, pro, "aspectRatio", "resolution", "16:9|4K", "4096*2304")
	assertComboOutput(t, pro, "aspectRatio", "resolution", "3:4|2K", "1728*2368")
	resolution := mustParam(t, pro, "resolution")
	if !resolution.Options[2].RequiresNoReferenceURLs {
		t.Fatal("Wan 2.7 Pro 4K should require no reference URLs")
	}

	standard := mustRoute(t, RouteOfficialWan27Image)
	if standard.Provider != ProviderAliyun || standard.Model != ModelWan27Image {
		t.Fatalf("standard provider/model = %q/%q, want %q/%q", standard.Provider, standard.Model, ProviderAliyun, ModelWan27Image)
	}
	assertOptionValues(t, mustParam(t, standard, "resolution"), []string{"1K", "2K"})
	assertParamDefault(t, standard, "resolution", "2K")
	assertParamDefault(t, standard, "n", float64(1))
	assertNoParams(t, standard, "watermark", "seed")

	if err := ValidateRequestForRoute(Request{
		Kind:          KindImage,
		RouteID:       pro.ID,
		ReferenceURLs: []string{"https://example.test/reference.png"},
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "4K",
		},
	}, pro); err == nil || !strings.Contains(err.Error(), "requires no reference URLs") {
		t.Fatalf("4K request with references error = %v", err)
	}

	translated, err := TranslateRouteParams(pro, map[string]any{
		"aspectRatio": "9:16",
		"resolution":  "4K",
		"n":           float64(4),
	})
	if err != nil {
		t.Fatalf("TranslateRouteParams() error = %v", err)
	}
	if translated["size"] != "2304*4096" || translated["n"] != float64(4) || translated["enable_sequential"] != false {
		t.Fatalf("translated params = %#v", translated)
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

func TestLibTVImageCatalogIncludesRequestedRoutes(t *testing.T) {
	cases := []struct {
		id            string
		familyID      string
		versionID     string
		model         string
		maxReferences int
		params        map[string]any
		ratios        []string
		resolutions   []string
		qualities     []string
	}{
		{
			id:            RouteLibTVGPTImage2,
			familyID:      FamilyGPTImage,
			versionID:     VersionGPTImage2,
			model:         "Lib Image",
			maxReferences: 10,
			params: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "2K",
				"quality":     "medium",
			},
			ratios:      []string{"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"},
			resolutions: []string{"1K", "2K", "4K"},
			qualities:   []string{"low", "medium", "high"},
		},
		{
			id:            RouteLibTVNanoBanana31,
			familyID:      FamilyNanoBanana,
			versionID:     VersionNanoBanana31,
			model:         "Lib Navo 2",
			maxReferences: 7,
			params: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "2K",
			},
			ratios:      []string{"adaptive", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "8:1", "1:8", "4:1", "1:4", "21:9"},
			resolutions: []string{"1K", "2K", "4K"},
		},
		{
			id:            RouteLibTVSeedream5Lite,
			familyID:      FamilySeedream,
			versionID:     VersionSeedream5Lite,
			model:         "Seedream 5.0 Lite",
			maxReferences: 6,
			params: map[string]any{
				"aspectRatio": "16:9",
				"resolution":  "2K",
			},
			ratios:      []string{"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"},
			resolutions: []string{"2K", "3K"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			route, ok := FindRoute(tc.id)
			if !ok {
				t.Fatalf("route %q is missing", tc.id)
			}
			if route.FamilyID != tc.familyID || route.VersionID != tc.versionID || route.Model != tc.model {
				t.Fatalf("route %q family/version/model = %q/%q/%q, want %q/%q/%q", tc.id, route.FamilyID, route.VersionID, route.Model, tc.familyID, tc.versionID, tc.model)
			}
			if route.Provider != ProviderLibTV || route.Kind != KindImage ||
				route.Adapter != AdapterLibTVCLIImage || route.Async ||
				!route.SupportsReferenceURLs || route.MaxReferenceURLs != tc.maxReferences {
				t.Fatalf("route %q metadata = %#v", tc.id, route)
			}
			if !reflect.DeepEqual(route.AuthKeys, []string{ProviderLibTV}) {
				t.Fatalf("route %q auth keys = %#v, want %#v", tc.id, route.AuthKeys, []string{ProviderLibTV})
			}
			if len(route.Params) != len(tc.params) {
				t.Fatalf("route %q params = %#v, want exactly %#v", tc.id, route.Params, tc.params)
			}
			for name, want := range tc.params {
				assertParamDefault(t, route, name, want)
			}
			assertOptionValues(t, mustParam(t, route, "aspectRatio"), tc.ratios)
			assertOptionValues(t, mustParam(t, route, "resolution"), tc.resolutions)
			if tc.qualities != nil {
				assertOptionValues(t, mustParam(t, route, "quality"), tc.qualities)
			}
		})
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

func TestCatalogKeepsLegacyModelIDs(t *testing.T) {
	route, ok := FindRouteByLegacyModelID(ModelJimengSeedance2Fast)
	if !ok {
		t.Fatal("legacy seedance model does not map to a route")
	}
	if route.ID != RouteDMXSeedance20Fast {
		t.Fatalf("legacy seedance route = %q, want %q", route.ID, RouteDMXSeedance20Fast)
	}

	model, ok := FindModel(ModelNanoBanana)
	if !ok {
		t.Fatal("legacy nano banana model is missing")
	}
	if model.Model != "gemini-3.1-flash-image" {
		t.Fatalf("legacy nano banana provider model = %q", model.Model)
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

func TestCatalogCopiesParamBounds(t *testing.T) {
	route := mustRoute(t, RouteDMXGPTImage2)
	param := mustParam(t, route, "outputCompression")
	if param.Min == nil || param.Max == nil {
		t.Fatal("outputCompression should have min and max bounds")
	}
	originalMin := *param.Min
	originalMax := *param.Max
	*param.Min = -999
	*param.Max = 999

	nextRoute := mustRoute(t, RouteDMXGPTImage2)
	nextParam := mustParam(t, nextRoute, "outputCompression")
	if nextParam.Min == nil || nextParam.Max == nil {
		t.Fatal("outputCompression lost min or max bounds")
	}
	if *nextParam.Min != originalMin || *nextParam.Max != originalMax {
		t.Fatalf("FindRoute() returned mutated param bounds: min=%v max=%v", *nextParam.Min, *nextParam.Max)
	}
}

func TestDefaultRoutes(t *testing.T) {
	imageRoute, ok := DefaultRoute(KindImage)
	if !ok {
		t.Fatal("image default route is missing")
	}
	if imageRoute.ID != RouteDMXSeedream5Lite {
		t.Fatalf("image default route = %q, want %q", imageRoute.ID, RouteDMXSeedream5Lite)
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

func TestResolveRoute(t *testing.T) {
	route, err := ResolveRoute(RouteQuery{RouteID: RouteOpenRouterSeedance20Fast, Kind: KindVideo})
	if err != nil {
		t.Fatalf("ResolveRoute() error = %v", err)
	}
	if route.ID != RouteOpenRouterSeedance20Fast {
		t.Fatalf("route = %q, want %q", route.ID, RouteOpenRouterSeedance20Fast)
	}

	route, err = ResolveRoute(RouteQuery{ModelID: ModelGPTImage2})
	if err != nil {
		t.Fatalf("ResolveRoute() legacy error = %v", err)
	}
	if route.ID != RouteDMXGPTImage2 {
		t.Fatalf("legacy route = %q, want %q", route.ID, RouteDMXGPTImage2)
	}

	if _, err := ResolveRoute(RouteQuery{RouteID: RouteDMXGPTImage2, Kind: KindVideo}); err == nil {
		t.Fatal("ResolveRoute() accepted a mismatched kind")
	}

	if _, err := ResolveRoute(RouteQuery{RouteID: RouteDMXGPTImage2, Provider: ProviderOpenAI}); err == nil {
		t.Fatal("ResolveRoute() accepted a mismatched provider")
	}

	route, err = ResolveDefaultRouteForProvider(KindImage, ProviderOpenAI)
	if err != nil {
		t.Fatalf("ResolveDefaultRouteForProvider() error = %v", err)
	}
	if route.Provider != ProviderOpenAI || route.Kind != KindImage {
		t.Fatalf("default openai route = %#v", route)
	}

	route, err = ResolveDefaultRouteForProvider(KindText, ProviderOpenRouter)
	if err != nil {
		t.Fatalf("ResolveDefaultRouteForProvider(text) error = %v", err)
	}
	if route.ID != RouteOpenRouterGPT55Text || route.Kind != KindText {
		t.Fatalf("default openrouter text route = %#v", route)
	}
}

func TestValidateRequestForRouteRejectsUnsupportedReferenceURLs(t *testing.T) {
	route := mustRoute(t, RouteOfficialGPTImage2)
	err := ValidateRequestForRoute(Request{
		Kind:          KindImage,
		ReferenceURLs: []string{"https://example.test/reference.png"},
	}, route)
	if err == nil {
		t.Fatal("ValidateRequestForRoute() accepted reference URLs for a route that does not support them")
	}

	route = mustRoute(t, RouteDMXGPTImage2)
	err = ValidateRequestForRoute(Request{
		Kind:          KindImage,
		ReferenceURLs: []string{"https://example.test/reference.png"},
	}, route)
	if err != nil {
		t.Fatalf("ValidateRequestForRoute() rejected supported references: %v", err)
	}

	err = ValidateRequestForRoute(Request{
		Kind: KindImage,
		ReferenceURLs: []string{
			"https://example.test/reference-1.png",
			"https://example.test/reference-2.png",
			"https://example.test/reference-3.png",
			"https://example.test/reference-4.png",
		},
	}, route)
	if err != nil {
		t.Fatalf("ValidateRequestForRoute() rejected references within the route limit: %v", err)
	}

	err = ValidateRequestForRoute(Request{
		Kind: KindImage,
		ReferenceURLs: []string{
			"https://example.test/reference-1.png",
			"https://example.test/reference-2.png",
			"https://example.test/reference-3.png",
			"https://example.test/reference-4.png",
			"https://example.test/reference-5.png",
		},
	}, route)
	if err == nil {
		t.Fatal("ValidateRequestForRoute() accepted reference URLs beyond the route limit")
	}
	if !strings.Contains(err.Error(), "supports at most 4 reference URLs") {
		t.Fatalf("ValidateRequestForRoute() error = %q, want max reference limit", err)
	}
}

func TestValidateRouteParams(t *testing.T) {
	route := mustRoute(t, RouteDMXGPTImage2)
	err := ValidateRouteParams(route, map[string]any{
		"quality": "ultra",
	})
	if err == nil {
		t.Fatal("ValidateRouteParams() accepted an invalid select option")
	}

	err = ValidateRouteParams(route, map[string]any{
		"outputCompression": float64(101),
	})
	if err == nil {
		t.Fatal("ValidateRouteParams() accepted a number above max")
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

func TestRouteParamsMatchProviderCapabilities(t *testing.T) {
	dmxSeedance := mustRoute(t, RouteDMXSeedance20Fast)
	assertHasParams(t, dmxSeedance, "aspectRatio", "resolution", "duration", "generateAudio", "seed", "watermark", "returnLastFrame", "executionExpiresAfter")
	assertNoParams(t, dmxSeedance, "negativePrompt")

	officialGPTImage := mustRoute(t, RouteOfficialGPTImage2)
	assertHasParams(t, officialGPTImage, "aspectRatio", "resolution", "quality", "outputFormat", "moderation", "outputCompression", "background", "n")

	dmxGPTImage := mustRoute(t, RouteDMXGPTImage2)
	assertHasParams(t, dmxGPTImage, "aspectRatio", "resolution", "quality", "outputFormat", "moderation", "outputCompression", "n")
	assertNoParams(t, dmxGPTImage, "background")
	if !dmxGPTImage.SupportsReferenceURLs {
		t.Fatal("dmx gpt image route should support reference images")
	}
	if dmxGPTImage.MaxReferenceURLs != 4 {
		t.Fatalf("dmx gpt image max references = %d, want 4", dmxGPTImage.MaxReferenceURLs)
	}

	mediagoGPTImage := mustRoute(t, RouteMediagoGPTImage2)
	assertHasParams(t, mediagoGPTImage, "aspectRatio", "resolution", "quality", "outputFormat", "moderation", "outputCompression", "n", "background")
	if !mediagoGPTImage.SupportsReferenceURLs {
		t.Fatal("mediago gpt image route should support reference images through MediaGo input_references")
	}
	if mediagoGPTImage.MaxReferenceURLs != 4 {
		t.Fatalf("mediago gpt image max references = %d, want 4", mediagoGPTImage.MaxReferenceURLs)
	}
	mediagoGPTImageRatio := mustParam(t, mediagoGPTImage, "aspectRatio")
	assertHasOptions(t, mediagoGPTImageRatio, "adaptive", "1:1", "3:2", "2:3", "16:9", "9:16")
	assertComboOutput(t, mediagoGPTImage, "aspectRatio", "resolution", "16:9|2K", "2048x1152")
	assertComboOutput(t, mediagoGPTImage, "aspectRatio", "resolution", "16:9|4K", "3840x2160")
	assertComboOutput(t, mediagoGPTImage, "aspectRatio", "resolution", "9:16|4K", "2160x3840")

	dmxSeedream := mustRoute(t, RouteDMXSeedream5Lite)
	assertHasOptions(t, mustParam(t, dmxSeedream, "aspectRatio"), "3:4")

	nanoBanana := mustRoute(t, RouteDMXNanoBanana31)
	if !nanoBanana.SupportsReferenceURLs {
		t.Fatal("dmx nano banana route should support reference images")
	}
	if nanoBanana.MaxReferenceURLs != 4 {
		t.Fatalf("dmx nano banana max references = %d, want 4", nanoBanana.MaxReferenceURLs)
	}
	officialNanoBanana := mustRoute(t, RouteOfficialNanoBanana31)
	if !officialNanoBanana.SupportsReferenceURLs {
		t.Fatal("official nano banana route should support reference images")
	}
	aspectRatio := mustParam(t, nanoBanana, "aspectRatio")
	assertHasOptions(t, aspectRatio, "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9", "9:21")
	assertHasOptions(t, mustParam(t, officialNanoBanana, "resolution"), "512px", "1K", "2K", "4K")
	assertHasOptions(t, mustParam(t, nanoBanana, "resolution"), "512px", "1K", "2K", "4K")
	assertComboOutput(t, officialNanoBanana, "aspectRatio", "resolution", "1:1|512px", "512x512")
	assertComboOutput(t, nanoBanana, "aspectRatio", "resolution", "1:1|512px", "512x512")
	assertComboOutput(t, nanoBanana, "aspectRatio", "resolution", "16:9|1K", "1376x768")
	assertComboOutput(t, nanoBanana, "aspectRatio", "resolution", "1:4|4K", "2048x8192")
	assertComboOutput(t, nanoBanana, "aspectRatio", "resolution", "9:21|1K", "672x1584")
	mediagoNanoBanana := mustRoute(t, RouteMediagoNanoBanana31)
	assertHasParams(t, mediagoNanoBanana, "aspectRatio", "resolution", "n")
	assertNoParams(t, mediagoNanoBanana, "quality", "outputFormat", "moderation", "outputCompression", "background")
	assertHasOptions(t, mustParam(t, mediagoNanoBanana, "aspectRatio"), "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9")
	assertLacksOption(t, mustParam(t, mediagoNanoBanana, "aspectRatio"), "9:21")
	assertHasOptions(t, mustParam(t, mediagoNanoBanana, "resolution"), "1K", "2K", "4K")
	assertLacksOption(t, mustParam(t, mediagoNanoBanana, "resolution"), "512px")
	assertComboOutput(t, mediagoNanoBanana, "aspectRatio", "resolution", "16:9|1K", "1376x768")
	assertComboOutput(t, mediagoNanoBanana, "aspectRatio", "resolution", "4:3|2K", "2400x1792")
	mediagoNanoBananaPro := mustRoute(t, RouteMediagoNanoBananaPro)
	assertHasParams(t, mediagoNanoBananaPro, "aspectRatio", "resolution", "n")
	assertNoParams(t, mediagoNanoBananaPro, "quality", "outputFormat", "moderation", "outputCompression", "background")
	assertHasOptions(t, mustParam(t, mediagoNanoBananaPro, "aspectRatio"), "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
	assertLacksOption(t, mustParam(t, mediagoNanoBananaPro, "aspectRatio"), "1:4")
	assertLacksOption(t, mustParam(t, mediagoNanoBananaPro, "aspectRatio"), "9:21")
	assertHasOptions(t, mustParam(t, mediagoNanoBananaPro, "resolution"), "1K", "2K", "4K")
	assertLacksOption(t, mustParam(t, mediagoNanoBananaPro, "resolution"), "512px")
	assertComboOutput(t, mediagoNanoBananaPro, "aspectRatio", "resolution", "16:9|4K", "5504x3072")
	assertComboOutput(t, mediagoNanoBananaPro, "aspectRatio", "resolution", "4:3|2K", "2400x1792")
	mediagoNanoBanana25 := mustRoute(t, RouteMediagoNanoBanana25)
	assertHasParams(t, mediagoNanoBanana25, "aspectRatio", "resolution", "n")
	assertHasOptions(t, mustParam(t, mediagoNanoBanana25, "resolution"), "1K")
	assertLacksOption(t, mustParam(t, mediagoNanoBanana25, "resolution"), "2K")
	assertLacksOption(t, mustParam(t, mediagoNanoBanana25, "resolution"), "4K")
	assertLacksOption(t, mustParam(t, mediagoNanoBanana25, "aspectRatio"), "1:4")
	assertComboOutput(t, mediagoNanoBanana25, "aspectRatio", "resolution", "16:9|1K", "1344x768")

	seedanceDuration := mustParam(t, dmxSeedance, "duration")
	assertHasOptions(t, seedanceDuration, "-1", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15")

	jimengSeedream := mustRoute(t, RouteJimengSeedream50)
	assertHasParams(t, jimengSeedream, "aspectRatio", "resolution")
	if !jimengSeedream.SupportsReferenceURLs {
		t.Fatal("jimeng seedream route should support reference images")
	}
	if jimengSeedream.MaxReferenceURLs != 0 {
		t.Fatalf("jimeng seedream max references = %d, want unlimited", jimengSeedream.MaxReferenceURLs)
	}
	jimengSeedream47 := mustRoute(t, RouteJimengSeedream47)
	assertHasParams(t, jimengSeedream47, "aspectRatio", "resolution")

	jimengSeedance := mustRoute(t, RouteJimengSeedance20Fast)
	assertHasParams(t, jimengSeedance, "aspectRatio", "resolution", "duration")
	if !jimengSeedance.SupportsReferenceURLs {
		t.Fatal("jimeng seedance route should support reference images")
	}
	jimengSeedanceResolution := mustParam(t, jimengSeedance, "resolution")
	assertHasOptions(t, jimengSeedanceResolution, "720p")
	assertLacksOption(t, jimengSeedanceResolution, "1080p")

	jimengSeedanceMini := mustRoute(t, RouteJimengSeedance20Mini)
	assertHasParams(t, jimengSeedanceMini, "aspectRatio", "resolution", "duration")
	if jimengSeedanceMini.Model != "seedance2.0mini" {
		t.Fatalf("jimeng seedance mini model = %q", jimengSeedanceMini.Model)
	}
	jimengSeedanceMiniResolution := mustParam(t, jimengSeedanceMini, "resolution")
	assertHasOptions(t, jimengSeedanceMiniResolution, "720p")
	assertLacksOption(t, jimengSeedanceMiniResolution, "1080p")

	jimengSeedanceVIP := mustRoute(t, RouteJimengSeedance20VIP)
	assertHasParams(t, jimengSeedanceVIP, "aspectRatio", "resolution", "duration")
	if jimengSeedanceVIP.Model != "seedance2.0_vip" {
		t.Fatalf("jimeng seedance vip model = %q", jimengSeedanceVIP.Model)
	}
	assertHasOptions(t, mustParam(t, jimengSeedanceVIP, "resolution"), "720p", "1080p")

	minimaxSpeech := mustRoute(t, RouteOfficialMiniMaxSpeech28HD)
	if minimaxSpeech.Label != "MiniMax 国内" {
		t.Fatalf("minimax speech label = %q, want MiniMax 国内", minimaxSpeech.Label)
	}
	if minimaxSpeech.DocURL != "https://platform.minimaxi.com/docs/api-reference/speech-t2a-http" {
		t.Fatalf("minimax speech doc url = %q, want MiniMax domestic docs", minimaxSpeech.DocURL)
	}
	assertHasParams(t, minimaxSpeech, "voiceId", "speed", "volume", "pitch", "outputFormat", "sampleRate", "bitrate")
	voiceID := mustParam(t, minimaxSpeech, "voiceId")
	if voiceID.Type != "select" || voiceID.Group != string(ParamGroupVoice) {
		t.Fatalf("voiceId param = type %q group %q, want select/%s", voiceID.Type, voiceID.Group, ParamGroupVoice)
	}
	if len(voiceID.Options) < 300 {
		t.Fatalf("voiceId options = %d, want official system voice list", len(voiceID.Options))
	}
	assertHasOptions(t, voiceID, "Chinese (Mandarin)_Warm_Bestie", "male-qn-qingse", "English_Aussie_Bloke")
	assertParamDefault(t, minimaxSpeech, "voiceId", "Chinese (Mandarin)_Warm_Bestie")
	assertParamDefault(t, minimaxSpeech, "outputFormat", "mp3")
}

func TestRouteParamsDefaultToLowestCostOptions(t *testing.T) {
	dmxSeedance := mustRoute(t, RouteDMXSeedance20Fast)
	assertParamDefault(t, dmxSeedance, "resolution", "480p")
	assertParamDefault(t, dmxSeedance, "duration", "4")
	assertParamDefault(t, dmxSeedance, "generateAudio", false)

	officialSeedance := mustRoute(t, RouteOfficialSeedance20Fast)
	assertParamDefault(t, officialSeedance, "resolution", "480p")
	assertParamDefault(t, officialSeedance, "duration", "4")
	assertParamDefault(t, officialSeedance, "generateAudio", false)

	openRouterVideo := mustRoute(t, RouteOpenRouterSeedance20Fast)
	assertParamDefault(t, openRouterVideo, "resolution", "480p")
	assertParamDefault(t, openRouterVideo, "duration", "3")
	assertParamDefault(t, openRouterVideo, "generateAudio", false)

	dmxGPTImage := mustRoute(t, RouteDMXGPTImage2)
	assertParamDefault(t, dmxGPTImage, "aspectRatio", "1:1")
	assertParamDefault(t, dmxGPTImage, "resolution", "1K")
	assertParamDefault(t, dmxGPTImage, "quality", "auto")
	assertParamDefault(t, dmxGPTImage, "outputFormat", "png")
	assertParamDefault(t, dmxGPTImage, "n", float64(1))

	dmxNanoBanana := mustRoute(t, RouteDMXNanoBanana31)
	assertParamDefault(t, dmxNanoBanana, "resolution", "1K")
	assertParamDefault(t, dmxNanoBanana, "n", float64(1))

	mediagoNanoBananaPro := mustRoute(t, RouteMediagoNanoBananaPro)
	assertParamDefault(t, mediagoNanoBananaPro, "resolution", "1K")
	assertParamDefault(t, mediagoNanoBananaPro, "n", float64(1))
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
