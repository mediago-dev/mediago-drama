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
		ProviderVolcengine,
		ProviderDMX,
		ProviderOpenRouter,
		ProviderJimeng,
	} {
		if !providers[provider] {
			t.Fatalf("catalog does not expose provider %q", provider)
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
	if model.Model != "gemini-3.1-flash-image-preview" {
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
}

func TestVideoCatalogOnlyExposesSeedance(t *testing.T) {
	for _, family := range Families() {
		if family.Kind == KindVideo && family.ID != FamilySeedance {
			t.Fatalf("video family = %q, want only %q", family.ID, FamilySeedance)
		}
	}

	for _, version := range Versions() {
		if version.Kind == KindVideo && version.FamilyID != FamilySeedance {
			t.Fatalf("video version %q family = %q, want %q", version.ID, version.FamilyID, FamilySeedance)
		}
	}

	for _, route := range Routes() {
		if route.Kind == KindVideo && route.FamilyID != FamilySeedance {
			t.Fatalf("video route %q family = %q, want %q", route.ID, route.FamilyID, FamilySeedance)
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
	if route.ID != RouteOpenRouterGPT41MiniText || route.Kind != KindText {
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

	nanoBanana := mustRoute(t, RouteDMXNanoBanana31)
	if !nanoBanana.SupportsReferenceURLs {
		t.Fatal("dmx nano banana route should support reference images")
	}
	officialNanoBanana := mustRoute(t, RouteOfficialNanoBanana31)
	if !officialNanoBanana.SupportsReferenceURLs {
		t.Fatal("official nano banana route should support reference images")
	}
	aspectRatio := mustParam(t, nanoBanana, "aspectRatio")
	assertHasOptions(t, aspectRatio, "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9")

	seedanceDuration := mustParam(t, dmxSeedance, "duration")
	assertHasOptions(t, seedanceDuration, "-1", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15")

	jimengSeedream := mustRoute(t, RouteJimengSeedream50)
	assertHasParams(t, jimengSeedream, "aspectRatio", "resolution")
	if !jimengSeedream.SupportsReferenceURLs {
		t.Fatal("jimeng seedream route should support reference images")
	}
	jimengSeedream47 := mustRoute(t, RouteJimengSeedream47)
	assertHasParams(t, jimengSeedream47, "aspectRatio", "resolution")

	jimengSeedance := mustRoute(t, RouteJimengSeedance20Fast)
	assertHasParams(t, jimengSeedance, "aspectRatio", "resolution", "duration")
	if !jimengSeedance.SupportsReferenceURLs {
		t.Fatal("jimeng seedance route should support reference images")
	}

	jimengSeedanceVIP := mustRoute(t, RouteJimengSeedance20VIP)
	assertHasParams(t, jimengSeedanceVIP, "aspectRatio", "resolution", "duration")
	if jimengSeedanceVIP.Model != "seedance2.0_vip" {
		t.Fatalf("jimeng seedance vip model = %q", jimengSeedanceVIP.Model)
	}
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
	assertParamDefault(t, dmxGPTImage, "quality", "low")
	assertParamDefault(t, dmxGPTImage, "n", float64(1))

	dmxNanoBanana := mustRoute(t, RouteDMXNanoBanana31)
	assertParamDefault(t, dmxNanoBanana, "resolution", "1K")
	assertParamDefault(t, dmxNanoBanana, "n", float64(1))
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

func assertParamDefault(t *testing.T, route ModelRoute, name string, want any) {
	t.Helper()

	param := mustParam(t, route, name)
	if !reflect.DeepEqual(param.Default, want) {
		t.Fatalf("route %q param %q default = %#v, want %#v", route.ID, name, param.Default, want)
	}
}
