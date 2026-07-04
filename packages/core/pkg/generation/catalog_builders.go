package generation

import "strings"

func version(
	id string,
	familyID string,
	label string,
	kind Kind,
	canonicalModel string,
	async bool,
	supportsReferenceURLs bool,
) ModelVersion {
	return ModelVersion{
		ID:             id,
		FamilyID:       familyID,
		Label:          label,
		Kind:           kind,
		CanonicalModel: canonicalModel,
		Capabilities: Capabilities{
			Async:                 async,
			SupportsReferenceURLs: supportsReferenceURLs,
		},
	}
}

func dmxRoute(
	id string,
	familyID string,
	versionID string,
	label string,
	model string,
	adapter string,
	docURL string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
	legacyModelID string,
) ModelRoute {
	kind := kindForFamily(familyID)
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderDMX,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderDMX},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
		LegacyModelID:         legacyModelID,
	}
}

func jimengRoute(
	id string,
	familyID string,
	versionID string,
	label string,
	model string,
	adapter string,
	docURL string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
	legacyModelID string,
) ModelRoute {
	kind := kindForFamily(familyID)
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderJimeng,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderJimeng},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
		LegacyModelID:         legacyModelID,
	}
}

func xiaoyunqueRoute(
	id string,
	familyID string,
	versionID string,
	label string,
	model string,
	adapter string,
	docURL string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
	legacyModelID string,
) ModelRoute {
	kind := kindForFamily(familyID)
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderXiaoyunque,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderXiaoyunque},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
		LegacyModelID:         legacyModelID,
	}
}

func libTVRoute(
	id string,
	familyID string,
	versionID string,
	label string,
	model string,
	adapter string,
	docURL string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
	legacyModelID string,
) ModelRoute {
	kind := kindForFamily(familyID)
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderLibTV,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderLibTV},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
		LegacyModelID:         legacyModelID,
	}
}

func routeWithStatus(route ModelRoute, status RouteStatus, reason string) ModelRoute {
	route.Status = status
	route.StatusReason = reason
	return route
}

func openRouterRoute(
	id string,
	familyID string,
	versionID string,
	kind Kind,
	label string,
	model string,
	adapter string,
	docURL string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
) ModelRoute {
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderOpenRouter,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderOpenRouter},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
	}
}

func officialRoute(
	id string,
	familyID string,
	versionID string,
	kind Kind,
	label string,
	model string,
	adapter string,
	docURL string,
	authKeys []string,
	params RouteParamConfig,
	async bool,
	supportsReferenceURLs bool,
) ModelRoute {
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              routeProviderFromAuthKeys(authKeys),
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              authKeys,
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
	}
}

func routeParamCombos(params []RouteParam, joins []ParamJoin) []ParamCombo {
	if len(joins) == 0 {
		return nil
	}

	byID := make(map[ParamID]RouteParam, len(params))
	for _, param := range params {
		byID[param.ID] = param
	}

	combos := make([]ParamCombo, 0, len(joins))
	for _, join := range joins {
		if len(join.From) == 0 || len(join.Table) == 0 {
			continue
		}

		names := make([]string, 0, len(join.From))
		optionSets := make([][]string, 0, len(join.From))
		for _, id := range join.From {
			param, ok := byID[id]
			if !ok || len(param.Options) == 0 {
				optionSets = nil
				break
			}

			names = append(names, string(id))
			values := make([]string, 0, len(param.Options))
			for _, option := range param.Options {
				values = append(values, option.Value)
			}
			optionSets = append(optionSets, values)
		}
		if len(optionSets) != len(join.From) {
			continue
		}

		allowed := make([][]string, 0, len(join.Table))
		outputs := make(map[string]string, len(join.Table))
		for _, key := range cartesianRouteParamKeys(optionSets) {
			joinedKey := strings.Join(key, "|")
			if output, ok := join.Table[joinedKey]; ok {
				allowed = append(allowed, key)
				outputs[joinedKey] = output
			}
		}
		combos = append(combos, ParamCombo{
			Params:  names,
			Allowed: allowed,
			Outputs: outputs,
		})
	}

	return combos
}

func cartesianRouteParamKeys(optionSets [][]string) [][]string {
	if len(optionSets) == 0 {
		return nil
	}

	result := [][]string{{}}
	for _, options := range optionSets {
		next := make([][]string, 0, len(result)*len(options))
		for _, prefix := range result {
			for _, option := range options {
				key := make([]string, 0, len(prefix)+1)
				key = append(key, prefix...)
				key = append(key, option)
				next = append(next, key)
			}
		}
		result = next
	}

	return result
}

func routeProviderFromAuthKeys(authKeys []string) string {
	if len(authKeys) == 0 {
		return ""
	}
	return authKeys[0]
}

func kindForFamily(familyID string) Kind {
	switch familyID {
	case FamilyMiniMaxSpeech:
		return KindAudio
	case FamilyGPTText, FamilyGeminiText, FamilyMiniMaxText, FamilyDeepSeekText:
		return KindText
	case FamilySeedream, FamilyGPTImage, FamilyNanoBanana:
		return KindImage
	case FamilySeedance:
		return KindVideo
	default:
		return ""
	}
}
