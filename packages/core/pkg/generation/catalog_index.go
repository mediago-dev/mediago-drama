package generation

import catalogcache "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

type routeCatalogIndex struct {
	routes                []ModelRoute
	routesByID            map[string]ModelRoute
	routesByLegacyModelID map[string]ModelRoute
}

type modelCatalogIndex struct {
	models        []ModelSpec
	modelsByID    map[string]ModelSpec
	defaultModels map[Kind]ModelSpec
}

var (
	routeCatalogCache catalogcache.Cache[routeCatalogIndex]
	modelCatalogCache catalogcache.Cache[modelCatalogIndex]
)

func routeCatalog() routeCatalogIndex {
	return routeCatalogCache.Get(func() routeCatalogIndex {
		routes := []ModelRoute{}
		for _, group := range ModelFamilyGroups() {
			routes = append(routes, group.Routes...)
		}

		routesByID := make(map[string]ModelRoute, len(routes))
		routesByLegacyModelID := make(map[string]ModelRoute)
		for _, route := range routes {
			cloned := cloneRoute(route)
			routesByID[route.ID] = cloned
			if route.LegacyModelID != "" {
				if _, exists := routesByLegacyModelID[route.LegacyModelID]; !exists {
					routesByLegacyModelID[route.LegacyModelID] = cloned
				}
			}
		}

		return routeCatalogIndex{
			routes:                cloneRoutes(routes),
			routesByID:            routesByID,
			routesByLegacyModelID: routesByLegacyModelID,
		}
	})
}

func modelCatalog() modelCatalogIndex {
	return modelCatalogCache.Get(func() modelCatalogIndex {
		models := buildModels()
		modelsByID := make(map[string]ModelSpec, len(models))
		defaultModels := make(map[Kind]ModelSpec)
		for _, model := range models {
			cloned := cloneModel(model)
			modelsByID[model.ID] = cloned
			if _, exists := defaultModels[model.Kind]; !exists {
				defaultModels[model.Kind] = cloned
			}
		}

		return modelCatalogIndex{
			models:        cloneModels(models),
			modelsByID:    modelsByID,
			defaultModels: defaultModels,
		}
	})
}
