package generation

import (
	"errors"
	"fmt"
	"strings"
)

// RouteQuery identifies the user-facing route selector fields.
type RouteQuery struct {
	Kind     Kind
	RouteID  string
	ModelID  string
	Provider string
}

// ResolveRoute resolves a user-facing route query to a concrete executable route.
func ResolveRoute(query RouteQuery) (ModelRoute, error) {
	if query.RouteID != "" {
		route, ok := FindRoute(query.RouteID)
		if !ok {
			return ModelRoute{}, fmt.Errorf("unknown generation route %q", query.RouteID)
		}
		if query.Kind != "" && query.Kind != route.Kind {
			return ModelRoute{}, fmt.Errorf("route %q is %s, not %s", route.ID, route.Kind, query.Kind)
		}
		if err := validateRouteProvider(route, query); err != nil {
			return ModelRoute{}, err
		}

		return route, nil
	}

	if query.ModelID != "" {
		route, ok := FindRouteByLegacyModelID(query.ModelID)
		if !ok {
			return ModelRoute{}, fmt.Errorf("unknown generation model %q", query.ModelID)
		}
		if query.Kind != "" && query.Kind != route.Kind {
			return ModelRoute{}, fmt.Errorf("model %q is %s, not %s", query.ModelID, route.Kind, query.Kind)
		}
		if err := validateRouteProvider(route, query); err != nil {
			return ModelRoute{}, err
		}

		return route, nil
	}

	kind := query.Kind
	if kind == "" {
		kind = KindImage
	}
	route, ok := defaultRoute(kind, query.Provider)
	if !ok {
		if query.Provider != "" {
			return ModelRoute{}, fmt.Errorf("no %s generation route is available for %q", query.Provider, kind)
		}
		return ModelRoute{}, fmt.Errorf("no generation route is available for %q", kind)
	}

	return route, nil
}

// ResolveRequestRoute resolves the route for a generation request.
func ResolveRequestRoute(request Request) (ModelRoute, error) {
	return ResolveRoute(RouteQuery{
		Kind:    request.Kind,
		RouteID: request.RouteID,
		ModelID: request.ModelID,
	})
}

// ResolveRequestRouteForProvider resolves a request route only when the request names one.
func ResolveRequestRouteForProvider(request Request, provider string) (ModelRoute, bool, error) {
	if request.RouteID == "" && request.ModelID == "" {
		return ModelRoute{}, false, nil
	}

	route, err := ResolveRoute(RouteQuery{
		Kind:     request.Kind,
		RouteID:  request.RouteID,
		ModelID:  request.ModelID,
		Provider: provider,
	})
	if err != nil {
		return ModelRoute{}, false, err
	}

	return route, true, nil
}

// ResolveDefaultRouteForProvider resolves the default executable route for one provider.
func ResolveDefaultRouteForProvider(kind Kind, provider string) (ModelRoute, error) {
	return ResolveRoute(RouteQuery{
		Kind:     kind,
		Provider: provider,
	})
}

// FindRouteByTaskPrefix resolves a task id prefix as either a route id or legacy model id.
func FindRouteByTaskPrefix(prefix string) (ModelRoute, bool) {
	route, ok := FindRoute(prefix)
	if ok {
		return route, true
	}

	return FindRouteByLegacyModelID(prefix)
}

// ValidateRouteAvailable rejects cataloged routes that cannot be executed by this build.
func ValidateRouteAvailable(route ModelRoute) error {
	if route.Status == RouteStatusAvailable {
		return nil
	}
	if route.StatusReason != "" {
		return errors.New(route.StatusReason)
	}

	return fmt.Errorf("generation route %q is not available", route.ID)
}

// ValidateRequestForRoute rejects requests that contradict route capabilities.
func ValidateRequestForRoute(request Request, route ModelRoute) error {
	if err := ValidateRouteAvailable(route); err != nil {
		return err
	}
	if request.Kind != "" && request.Kind != route.Kind {
		return fmt.Errorf("route %q is %s, not %s", route.ID, route.Kind, request.Kind)
	}
	referenceURLs := compactReferenceURLs(request.ReferenceURLs)
	if len(referenceURLs) > 0 && !route.SupportsReferenceURLs {
		return fmt.Errorf("route %q does not support reference URLs", route.ID)
	}
	if route.MaxReferenceURLs > 0 && len(referenceURLs) > route.MaxReferenceURLs {
		return fmt.Errorf("route %q supports at most %d reference URLs", route.ID, route.MaxReferenceURLs)
	}
	if !request.ParamsResolved {
		normalizedParams, err := NormalizeRouteParams(route, request.Params)
		if err != nil {
			return err
		}
		if err := ValidateRouteParamTranslation(route, normalizedParams); err != nil {
			return err
		}
	}

	return nil
}

// ApplyRoute fills route-derived request fields when the caller left them empty.
func ApplyRoute(request Request, route ModelRoute) Request {
	request.Kind = route.Kind
	request.RouteID = route.ID
	request.FamilyID = route.FamilyID
	request.VersionID = route.VersionID
	request.Provider = route.Provider
	if request.Model == "" {
		request.Model = route.Model
	}
	if request.ModelID == "" {
		request.ModelID = route.LegacyModelID
	}
	if !request.ParamsResolved {
		if normalizedParams, err := NormalizeRouteParams(route, request.Params); err == nil {
			if translatedParams, err := TranslateRouteParams(route, normalizedParams); err == nil {
				request.Params = translatedParams
				request.ParamsResolved = true
			}
		}
	}

	return request
}

func validateRouteProvider(route ModelRoute, query RouteQuery) error {
	if query.Provider != "" && route.Provider != query.Provider {
		return fmt.Errorf("route %q uses provider %q, not %q", route.ID, route.Provider, query.Provider)
	}

	return nil
}

func compactReferenceURLs(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}

	return result
}
