package generation

func legacyRouteIDs() map[string]string {
	return map[string]string{
		ModelSeedream5Lite:       RouteOfficialSeedream5Lite,
		ModelGPT41MiniText:       RouteOfficialGPT41MiniText,
		ModelGPTImage2:           RouteOfficialGPTImage2,
		ModelNanoBanana:          RouteOfficialNanoBanana31,
		ModelJimengSeedance2Fast: RouteJimengSeedance20Fast,
	}
}

func buildModels() []ModelSpec {
	return []ModelSpec{
		legacyModel(ModelSeedream5Lite, "Seedream 5.0 Lite", RouteOfficialSeedream5Lite),
		legacyModel(ModelGPT41MiniText, "GPT-4.1 Mini Text", RouteOfficialGPT41MiniText),
		legacyModel(ModelGPTImage2, "GPT Image 2", RouteOfficialGPTImage2),
		legacyModel(ModelNanoBanana, "Nano Banana 2", RouteOfficialNanoBanana31),
		legacyModel(ModelJimengSeedance2Fast, "即梦 / Seedance 2.0 Fast", RouteJimengSeedance20Fast),
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
