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

func cloneStrings(values []string) []string {
	return cloneSlice(values)
}
