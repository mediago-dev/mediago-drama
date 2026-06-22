package generation

func routeParamConfig(params []RouteParam, translation ParamTranslation) RouteParamConfig {
	if translation.isZero() {
		translation = identityParamTranslation(params)
	}
	return RouteParamConfig{
		CanonicalParams: params,
		Translation:     translation,
	}
}

func identityRouteParamConfig(params []RouteParam) RouteParamConfig {
	return routeParamConfig(params, ParamTranslation{})
}

func selectRouteParam(id ParamID, defaultValue string, options []ParamOption) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
		Options: options,
	}
}

func numberRouteParam(id ParamID, defaultValue float64, minValue float64, maxValue float64) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
		Min:     &minValue,
		Max:     &maxValue,
	}
}

func optionalNumberRouteParam(id ParamID, minValue float64, maxValue float64) RouteParam {
	return RouteParam{
		ID:  id,
		Min: &minValue,
		Max: &maxValue,
	}
}

func boolRouteParam(id ParamID, defaultValue bool) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
	}
}

func textRouteParam(id ParamID, defaultValue string) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
	}
}

func withRouteHelp(param RouteParam, help string) RouteParam {
	param.Help = help
	return param
}

func routeParamSpecs(kind Kind, params []RouteParam) []ParamSpec {
	specs := make([]ParamSpec, 0, len(params))
	for _, param := range params {
		spec, ok := CanonicalParam(kind, param.ID)
		if !ok {
			specs = append(specs, ParamSpec{
				Name:    string(param.ID),
				Default: param.Default,
			})
			continue
		}

		options := spec.Options
		if param.Options != nil {
			options = param.Options
		}
		minValue := spec.Min
		if param.Min != nil {
			minValue = param.Min
		}
		maxValue := spec.Max
		if param.Max != nil {
			maxValue = param.Max
		}
		help := spec.Help
		if param.Help != "" {
			help = param.Help
		}

		specs = append(specs, ParamSpec{
			Name:    string(param.ID),
			Label:   spec.Label,
			Type:    spec.Type,
			Group:   string(spec.Group),
			Menu:    string(paramMenuForGroup(spec.Group)),
			Default: param.Default,
			Options: cloneOptions(options),
			Min:     cloneFloatPointer(minValue),
			Max:     cloneFloatPointer(maxValue),
			Help:    help,
		})
	}

	return specs
}

func routeParamGroups(kind Kind, params []RouteParam) []RouteParamGroup {
	groupSpecs, ok := paramGroupsByKind[kind]
	if !ok {
		return nil
	}

	paramsByGroup := make(map[ParamGroupID][]string, len(groupSpecs))
	for _, param := range params {
		spec, ok := CanonicalParam(kind, param.ID)
		if !ok {
			continue
		}
		paramsByGroup[spec.Group] = append(paramsByGroup[spec.Group], string(param.ID))
	}

	groups := make([]RouteParamGroup, 0, len(groupSpecs))
	for _, groupSpec := range groupSpecs {
		groupParams := paramsByGroup[groupSpec.ID]
		if len(groupParams) == 0 {
			continue
		}
		groups = append(groups, RouteParamGroup{
			ID:     string(groupSpec.ID),
			Label:  groupSpec.Label,
			Params: cloneStrings(groupParams),
		})
	}

	return groups
}

func paramMenuForGroup(group ParamGroupID) ParamMenu {
	if group == ParamGroupOther {
		return ParamMenuSecondary
	}
	return ParamMenuPrimary
}

func identityParamTranslation(params []RouteParam) ParamTranslation {
	moves := make([]ParamMove, 0, len(params))
	for _, param := range params {
		moves = append(moves, ParamMove{From: param.ID})
	}

	return ParamTranslation{Moves: moves}
}

func (translation ParamTranslation) isZero() bool {
	return len(translation.Moves) == 0 && len(translation.Joins) == 0 && len(translation.Consts) == 0
}
