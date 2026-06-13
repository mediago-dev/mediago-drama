package generation

func cloneSlice[T any](values []T) []T {
	result := make([]T, len(values))
	copy(result, values)
	return result
}

func cloneRoutes(routes []ModelRoute) []ModelRoute {
	result := make([]ModelRoute, len(routes))
	for index, route := range routes {
		result[index] = cloneRoute(route)
	}

	return result
}

func cloneVersions(versions []ModelVersion) []ModelVersion {
	return cloneSlice(versions)
}

func cloneRoute(route ModelRoute) ModelRoute {
	route.AuthKeys = cloneStrings(route.AuthKeys)
	route.Params = cloneParams(route.Params)
	route.Combos = cloneParamCombos(route.Combos)
	route.CanonicalParams = cloneRouteParams(route.CanonicalParams)
	route.Translation = cloneParamTranslation(route.Translation)
	return route
}

func cloneModels(models []ModelSpec) []ModelSpec {
	result := make([]ModelSpec, len(models))
	for index, model := range models {
		result[index] = cloneModel(model)
	}

	return result
}

func cloneModel(model ModelSpec) ModelSpec {
	model.Params = cloneParams(model.Params)
	return model
}

func cloneParams(params []ParamSpec) []ParamSpec {
	result := make([]ParamSpec, len(params))
	for index, param := range params {
		param.Options = cloneOptions(param.Options)
		param.Min = cloneFloatPointer(param.Min)
		param.Max = cloneFloatPointer(param.Max)
		result[index] = param
	}

	return result
}

func cloneRouteParams(params []RouteParam) []RouteParam {
	result := make([]RouteParam, len(params))
	for index, param := range params {
		param.Options = cloneOptions(param.Options)
		param.Min = cloneFloatPointer(param.Min)
		param.Max = cloneFloatPointer(param.Max)
		result[index] = param
	}

	return result
}

func cloneParamTranslation(translation ParamTranslation) ParamTranslation {
	return ParamTranslation{
		Moves:  cloneParamMoves(translation.Moves),
		Joins:  cloneParamJoins(translation.Joins),
		Consts: cloneVendorConsts(translation.Consts),
	}
}

func cloneParamMoves(moves []ParamMove) []ParamMove {
	result := make([]ParamMove, len(moves))
	for index, move := range moves {
		move.Values = cloneStringMap(move.Values)
		result[index] = move
	}

	return result
}

func cloneParamJoins(joins []ParamJoin) []ParamJoin {
	result := make([]ParamJoin, len(joins))
	for index, join := range joins {
		join.From = cloneSlice(join.From)
		join.Table = cloneStringMap(join.Table)
		result[index] = join
	}

	return result
}

func cloneVendorConsts(consts []VendorConst) []VendorConst {
	return cloneSlice(consts)
}

func cloneFloatPointer(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneOptions(options []ParamOption) []ParamOption {
	return cloneSlice(options)
}

func cloneParamCombos(combos []ParamCombo) []ParamCombo {
	if combos == nil {
		return nil
	}
	result := make([]ParamCombo, len(combos))
	for index, combo := range combos {
		combo.Params = cloneStrings(combo.Params)
		combo.Allowed = cloneStringMatrix(combo.Allowed)
		result[index] = combo
	}

	return result
}

func cloneStringMatrix(values [][]string) [][]string {
	if values == nil {
		return nil
	}
	result := make([][]string, len(values))
	for index, value := range values {
		result[index] = cloneStrings(value)
	}
	return result
}

func cloneStrings(values []string) []string {
	return cloneSlice(values)
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
