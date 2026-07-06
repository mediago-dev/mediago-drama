package generation

import (
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"
	mediagocatalog "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/mediago"
)

func mediagoRoutesForFamily(familyID string) []ModelRoute {
	specs := mediagocatalog.RoutesForFamily(familyID)
	routes := make([]ModelRoute, 0, len(specs))
	for _, spec := range specs {
		routes = append(routes, mediagoRouteFromSpec(spec))
	}
	return routes
}

func mediagoRouteFromSpec(spec catalog.RouteSpec) ModelRoute {
	params := routeParamConfigFromCatalog(spec.Params)
	kind := Kind(spec.Kind)
	return ModelRoute{
		ID:                    spec.ID,
		FamilyID:              spec.FamilyID,
		VersionID:             spec.VersionID,
		Label:                 spec.Label,
		Kind:                  kind,
		Provider:              ProviderMediago,
		Model:                 spec.Model,
		Adapter:               spec.Adapter,
		DocURL:                spec.DocURL,
		Async:                 spec.Async,
		SupportsReferenceURLs: spec.SupportsReferenceURLs,
		MaxReferenceURLs:      spec.MaxReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderMediago},
		Params:                routeParamSpecs(kind, params.CanonicalParams),
		ParamGroups:           routeParamGroups(kind, params.CanonicalParams),
		Combos:                cloneParamCombos(params.Combos),
		CanonicalParams:       params.CanonicalParams,
		Translation:           params.Translation,
	}
}

func routeParamConfigFromCatalog(config catalog.ParamConfig) RouteParamConfig {
	return RouteParamConfig{
		CanonicalParams: routeParamsFromCatalog(config.CanonicalParams),
		Translation:     paramTranslationFromCatalog(config.Translation),
		Combos:          paramCombosFromCatalog(config.Combos),
	}
}

func routeParamsFromCatalog(params []catalog.RouteParam) []RouteParam {
	result := make([]RouteParam, 0, len(params))
	for _, param := range params {
		result = append(result, RouteParam{
			ID:      ParamID(param.ID),
			Default: param.Default,
			Options: paramOptionsFromCatalog(param.Options),
			Min:     cloneFloatPointer(param.Min),
			Max:     cloneFloatPointer(param.Max),
			Help:    param.Help,
		})
	}
	return result
}

func paramOptionsFromCatalog(options []catalog.ParamOption) []ParamOption {
	result := make([]ParamOption, 0, len(options))
	for _, option := range options {
		result = append(result, ParamOption{
			Label: option.Label,
			Value: option.Value,
		})
	}
	return result
}

func paramTranslationFromCatalog(translation catalog.ParamTranslation) ParamTranslation {
	return ParamTranslation{
		Moves:  paramMovesFromCatalog(translation.Moves),
		Joins:  paramJoinsFromCatalog(translation.Joins),
		Consts: vendorConstsFromCatalog(translation.Consts),
	}
}

func paramMovesFromCatalog(moves []catalog.ParamMove) []ParamMove {
	result := make([]ParamMove, 0, len(moves))
	for _, move := range moves {
		result = append(result, ParamMove{
			From:   ParamID(move.From),
			To:     move.To,
			Values: cloneStringMap(move.Values),
		})
	}
	return result
}

func paramJoinsFromCatalog(joins []catalog.ParamJoin) []ParamJoin {
	result := make([]ParamJoin, 0, len(joins))
	for _, join := range joins {
		from := make([]ParamID, 0, len(join.From))
		for _, id := range join.From {
			from = append(from, ParamID(id))
		}
		result = append(result, ParamJoin{
			From:  from,
			To:    join.To,
			Table: cloneStringMap(join.Table),
		})
	}
	return result
}

func vendorConstsFromCatalog(consts []catalog.VendorConst) []VendorConst {
	result := make([]VendorConst, 0, len(consts))
	for _, item := range consts {
		result = append(result, VendorConst{
			To:    item.To,
			Value: item.Value,
		})
	}
	return result
}

func paramCombosFromCatalog(combos []catalog.ParamCombo) []ParamCombo {
	result := make([]ParamCombo, 0, len(combos))
	for _, combo := range combos {
		result = append(result, ParamCombo{
			Params:  cloneStrings(combo.Params),
			Allowed: cloneStringMatrix(combo.Allowed),
			Outputs: cloneStringMap(combo.Outputs),
		})
	}
	return result
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
