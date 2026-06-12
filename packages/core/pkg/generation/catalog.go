package generation

// Catalog returns the full generation model catalog.
func Catalog() ModelCatalog {
	return ModelCatalog{
		Families:  Families(),
		Versions:  Versions(),
		Routes:    Routes(),
		Models:    Models(),
		Providers: Providers(),
	}
}

// Families returns model product families.
func Families() []ModelFamily {
	groups := ModelFamilyGroups()
	families := make([]ModelFamily, 0, len(groups))
	for _, group := range groups {
		families = append(families, group.Family)
	}

	result := make([]ModelFamily, len(families))
	copy(result, families)
	return result
}

// Versions returns concrete model names grouped by family.
func Versions() []ModelVersion {
	versions := []ModelVersion{}
	for _, group := range ModelFamilyGroups() {
		versions = append(versions, group.Versions...)
	}

	result := make([]ModelVersion, len(versions))
	copy(result, versions)
	return result
}

// Routes returns every concrete provider route.
func Routes() []ModelRoute {
	return cloneRoutes(routeCatalog().routes)
}

// ModelFamilyGroups returns catalog definitions grouped by model family.
func ModelFamilyGroups() []ModelFamilyGroup {
	groups := make([]ModelFamilyGroup, 0, len(familySpecs))
	for _, spec := range familySpecs {
		groups = append(groups, ModelFamilyGroup{
			Family:   spec.Family,
			Versions: cloneVersions(spec.Versions),
			Routes:   cloneRoutes(spec.Routes),
		})
	}
	return groups
}

// Models returns the supported legacy generation model catalog.
func Models() []ModelSpec {
	return cloneModels(modelCatalog().models)
}

// FindModel returns one legacy model spec by UI-facing model id.
func FindModel(id string) (ModelSpec, bool) {
	model, ok := modelCatalog().modelsByID[id]
	if !ok {
		return ModelSpec{}, false
	}

	return cloneModel(model), true
}

// FindRoute returns one route by route id.
func FindRoute(id string) (ModelRoute, bool) {
	route, ok := routeCatalog().routesByID[id]
	if !ok {
		return ModelRoute{}, false
	}

	return cloneRoute(route), true
}

// FindRouteByLegacyModelID returns the preferred route for a legacy model id.
func FindRouteByLegacyModelID(id string) (ModelRoute, bool) {
	route, ok := routeCatalog().routesByLegacyModelID[id]
	if !ok {
		return ModelRoute{}, false
	}

	return cloneRoute(route), true
}

// DefaultModel returns the first legacy catalog model for a media kind.
func DefaultModel(kind Kind) (ModelSpec, bool) {
	model, ok := modelCatalog().defaultModels[kind]
	if !ok {
		return ModelSpec{}, false
	}

	return cloneModel(model), true
}

// DefaultRoute returns the first executable route for a media kind.
func DefaultRoute(kind Kind) (ModelRoute, bool) {
	return defaultRoute(kind, "")
}

func defaultRoute(kind Kind, provider string) (ModelRoute, bool) {
	for _, route := range routeCatalog().routes {
		if route.Kind != kind || route.Status != RouteStatusAvailable {
			continue
		}
		if provider != "" && route.Provider != provider {
			continue
		}

		return cloneRoute(route), true
	}

	return ModelRoute{}, false
}
