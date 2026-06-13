package generation

func selectParam(name string, label string, defaultValue string, options []ParamOption) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "select",
		Default: defaultValue,
		Options: options,
	}
}

func numberParam(name string, label string, defaultValue float64, minValue float64, maxValue float64) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "number",
		Default: defaultValue,
		Min:     &minValue,
		Max:     &maxValue,
	}
}

func optionalNumberParam(name string, label string, minValue float64, maxValue float64) ParamSpec {
	return ParamSpec{
		Name:  name,
		Label: label,
		Type:  "number",
		Min:   &minValue,
		Max:   &maxValue,
	}
}

func boolParam(name string, label string, defaultValue bool) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "boolean",
		Default: defaultValue,
	}
}

func textParam(name string, label string, defaultValue string) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "text",
		Default: defaultValue,
	}
}

func withHelp(param ParamSpec, help string) ParamSpec {
	param.Help = help
	return param
}

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

func routeParamSpecs(params []RouteParam) []ParamSpec {
	specs := make([]ParamSpec, 0, len(params))
	for _, param := range params {
		spec, ok := canonicalParamRegistry[param.ID]
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
			Default: param.Default,
			Options: cloneOptions(options),
			Min:     cloneFloatPointer(minValue),
			Max:     cloneFloatPointer(maxValue),
			Help:    help,
		})
	}

	return specs
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
