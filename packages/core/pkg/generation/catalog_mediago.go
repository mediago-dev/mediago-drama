package generation

const mediagoDocsURL = "https://mediago.torchstellar.com/account#apiKeys"

// MediaGo route metadata belongs to the model-family-first root catalog.
// Package generation/mediago owns only the HTTP execution protocols.
func mediagoRoute(
	id string,
	familyID string,
	versionID string,
	kind Kind,
	model string,
	adapter string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
	options ...routeOption,
) ModelRoute {
	route := ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 "MediaGo",
		Kind:                  kind,
		Provider:              ProviderMediago,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                mediagoDocsURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderMediago},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
	}
	applyRouteOptions(&route, options...)
	return route
}

func mediagoTextRoute(id string, familyID string, versionID string, model string) ModelRoute {
	return mediagoRoute(
		id,
		familyID,
		versionID,
		KindText,
		model,
		AdapterMediagoText,
		textParams(),
		false,
		false,
	)
}

func mediagoChatImageParams() RouteParamConfig {
	return routeParamConfig([]RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", nanoBanana25AspectRatioOptions()),
		selectRouteParam(ParamResolution, "1K", resolutionOptions("1K", "2K", "4K")),
	}, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio},
			{From: ParamResolution, To: "imageSize"},
		},
	})
}

func resolutionOptions(values ...string) []ParamOption {
	options := make([]ParamOption, 0, len(values))
	for _, value := range values {
		options = append(options, ParamOption{Label: value, Value: value})
	}
	return options
}

// RequiredMediagoModelIDs returns every MediaGo upstream model needed by one route.
func RequiredMediagoModelIDs(routeID string, model string) []string {
	if routeID == RouteMediagoHappyHorse11 {
		return []string{ModelHappyHorse11T2V, ModelHappyHorse11R2V}
	}
	if model == "" {
		return nil
	}
	return []string{model}
}

func concatModelRoutes(groups ...[]ModelRoute) []ModelRoute {
	count := 0
	for _, group := range groups {
		count += len(group)
	}
	result := make([]ModelRoute, 0, count)
	for _, group := range groups {
		result = append(result, group...)
	}
	return result
}
