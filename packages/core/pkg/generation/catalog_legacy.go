package generation

func buildModels() []ModelSpec {
	return []ModelSpec{
		legacyModel(ModelSeedream5Lite, "Seedream 5.0 Lite", RouteDMXSeedream5Lite),
		legacyModel(ModelGPT41MiniText, "GPT-4.1 Mini Text", RouteDMXGPT41MiniText),
		legacyModel(ModelGPTImage2, "GPT Image 2", RouteDMXGPTImage2),
		legacyModel(ModelNanoBanana, "Nano Banana 2", RouteDMXNanoBanana31),
		legacyModel(ModelJimengSeedance2Fast, "即梦 / Seedance 2.0 Fast", RouteDMXSeedance20Fast),
	}
}

func legacyModel(id string, label string, routeID string) ModelSpec {
	route, ok := FindRoute(routeID)
	if !ok {
		return ModelSpec{ID: id, Label: label}
	}

	return ModelSpec{
		ID:                    id,
		Label:                 label,
		Kind:                  route.Kind,
		Provider:              route.Provider,
		Model:                 route.Model,
		Adapter:               route.Adapter,
		DocURL:                route.DocURL,
		Async:                 route.Async,
		SupportsReferenceURLs: route.SupportsReferenceURLs,
		Params:                route.Params,
	}
}
