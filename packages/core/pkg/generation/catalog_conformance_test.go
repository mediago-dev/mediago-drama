package generation

import (
	"reflect"
	"strings"
	"testing"
)

func TestCatalogCanonicalParamConformance(t *testing.T) {
	for _, route := range Routes() {
		t.Run(route.ID, func(t *testing.T) {
			assertRouteParamsAreCanonical(t, route)
			assertRouteResolutionVocabulary(t, route)
			assertRouteCombosAreDerived(t, route)
			assertRouteTranslationConsumesParams(t, route)
			assertRouteTranslationTargetsAreUnique(t, route)
		})
	}
}

func assertRouteParamsAreCanonical(t *testing.T, route ModelRoute) {
	t.Helper()

	if !reflect.DeepEqual(route.Params, routeParamSpecs(route.CanonicalParams)) {
		t.Fatalf("route.Params is not derived from canonical params\nparams=%#v\ncanonical=%#v", route.Params, route.CanonicalParams)
	}

	for _, param := range route.CanonicalParams {
		canonical, ok := canonicalParamRegistry[param.ID]
		if !ok {
			t.Fatalf("canonical param %q is not registered", param.ID)
		}
		assertRouteOptionsNarrowCanonical(t, route, canonical, param)
		assertRouteBoundsNarrowCanonical(t, route, canonical, param)
		if !isEmptyParamValue(param.Default) {
			_, err := NormalizeRouteParams(route, map[string]any{string(param.ID): param.Default})
			if err != nil {
				t.Fatalf("default for %q does not validate: %v", param.ID, err)
			}
		}
	}
}

func assertRouteOptionsNarrowCanonical(
	t *testing.T,
	route ModelRoute,
	canonical CanonicalParamSpec,
	param RouteParam,
) {
	t.Helper()
	if len(param.Options) == 0 || len(canonical.Options) == 0 {
		return
	}

	allowed := map[string]bool{}
	for _, option := range canonical.Options {
		allowed[option.Value] = true
	}
	for _, option := range param.Options {
		if !allowed[option.Value] {
			t.Fatalf("route %q param %q option %q is outside canonical options", route.ID, param.ID, option.Value)
		}
	}
}

func assertRouteBoundsNarrowCanonical(
	t *testing.T,
	route ModelRoute,
	canonical CanonicalParamSpec,
	param RouteParam,
) {
	t.Helper()
	if canonical.Min != nil && param.Min != nil && *param.Min < *canonical.Min {
		t.Fatalf("route %q param %q min %v is below canonical min %v", route.ID, param.ID, *param.Min, *canonical.Min)
	}
	if canonical.Max != nil && param.Max != nil && *param.Max > *canonical.Max {
		t.Fatalf("route %q param %q max %v is above canonical max %v", route.ID, param.ID, *param.Max, *canonical.Max)
	}
}

func assertRouteResolutionVocabulary(t *testing.T, route ModelRoute) {
	t.Helper()

	param, ok := routeParamByID(route, ParamResolution)
	if !ok {
		return
	}

	allowed, ok := resolutionVocabularyByKind[route.Kind]
	if !ok {
		t.Fatalf("route %q declares resolution for unsupported kind %q", route.ID, route.Kind)
	}
	for _, option := range param.Options {
		if !allowed[option.Value] {
			t.Fatalf("route %q resolution option %q is outside %s vocabulary", route.ID, option.Value, route.Kind)
		}
	}
}

var resolutionVocabularyByKind = map[Kind]map[string]bool{
	KindImage: {
		"1K": true,
		"2K": true,
		"3K": true,
		"4K": true,
	},
	KindVideo: {
		"480p":  true,
		"720p":  true,
		"1080p": true,
	},
}

func assertRouteTranslationConsumesParams(t *testing.T, route ModelRoute) {
	t.Helper()

	consumed := map[ParamID]int{}
	for _, move := range route.Translation.Moves {
		consumed[move.From]++
		assertMoveValuesCoverRouteOptions(t, route, move)
	}
	for _, join := range route.Translation.Joins {
		for _, id := range join.From {
			consumed[id]++
		}
		assertJoinTableIsValid(t, route, join)
	}

	for _, param := range route.CanonicalParams {
		if consumed[param.ID] != 1 {
			t.Fatalf("route %q param %q consumed %d times, want once", route.ID, param.ID, consumed[param.ID])
		}
	}
	for id, count := range consumed {
		if count == 0 {
			continue
		}
		if !routeHasParam(route, id) {
			t.Fatalf("route %q translation consumes undeclared param %q", route.ID, id)
		}
	}
}

func assertMoveValuesCoverRouteOptions(t *testing.T, route ModelRoute, move ParamMove) {
	t.Helper()
	if len(move.Values) == 0 {
		return
	}

	param, ok := routeParamByID(route, move.From)
	if !ok {
		t.Fatalf("route %q move references missing param %q", route.ID, move.From)
	}
	for _, option := range param.Options {
		if _, ok := move.Values[option.Value]; !ok {
			t.Fatalf("route %q move %q->%q does not map option %q", route.ID, move.From, move.targetName(), option.Value)
		}
	}
}

func assertJoinTableIsValid(t *testing.T, route ModelRoute, join ParamJoin) {
	t.Helper()
	if len(join.From) == 0 || join.To == "" {
		t.Fatalf("route %q has incomplete join %#v", route.ID, join)
	}

	optionSets := make([]map[string]bool, 0, len(join.From))
	optionHits := make([]map[string]bool, 0, len(join.From))
	defaultParts := make([]string, 0, len(join.From))
	for _, id := range join.From {
		param, ok := routeParamByID(route, id)
		if !ok {
			t.Fatalf("route %q join references missing param %q", route.ID, id)
		}
		if len(param.Options) == 0 {
			t.Fatalf("route %q join %q param %q has no options", route.ID, join.To, id)
		}
		values := make(map[string]bool, len(param.Options))
		hits := make(map[string]bool, len(param.Options))
		for _, option := range param.Options {
			values[option.Value] = true
			hits[option.Value] = false
		}
		optionSets = append(optionSets, values)
		optionHits = append(optionHits, hits)

		defaultPart, ok := optionComparableString(param.Default)
		if !ok || defaultPart == "" {
			t.Fatalf("route %q join %q param %q has no default", route.ID, join.To, id)
		}
		defaultParts = append(defaultParts, defaultPart)
	}

	for key := range join.Table {
		parts := strings.Split(key, "|")
		if len(parts) != len(join.From) {
			t.Fatalf("route %q join %q key %q has %d parts, want %d", route.ID, join.To, key, len(parts), len(join.From))
		}
		for index, part := range parts {
			if !optionSets[index][part] {
				t.Fatalf("route %q join %q key %q has invalid value %q for %q", route.ID, join.To, key, part, join.From[index])
			}
			optionHits[index][part] = true
		}
	}

	for index, hits := range optionHits {
		for option, hit := range hits {
			if !hit {
				t.Fatalf("route %q join %q param %q option %q is never allowed", route.ID, join.To, join.From[index], option)
			}
		}
	}

	defaultKey := strings.Join(defaultParts, "|")
	if _, ok := join.Table[defaultKey]; !ok {
		t.Fatalf("route %q join %q default combo %q is not allowed", route.ID, join.To, defaultKey)
	}
}

func assertRouteCombosAreDerived(t *testing.T, route ModelRoute) {
	t.Helper()

	expected := routeParamCombos(route.CanonicalParams, route.Translation.Joins)
	if !reflect.DeepEqual(route.Combos, expected) {
		t.Fatalf("route %q paramCombos is not derived from joins\ncombos=%#v\nexpected=%#v", route.ID, route.Combos, expected)
	}
}

func assertRouteTranslationTargetsAreUnique(t *testing.T, route ModelRoute) {
	t.Helper()

	targets := map[string]string{}
	for _, move := range route.Translation.Moves {
		target := move.targetName()
		if target == "" {
			continue
		}
		assertUniqueTarget(t, route, targets, target, string(move.From))
	}
	for _, join := range route.Translation.Joins {
		assertUniqueTarget(t, route, targets, join.To, "join")
	}
	for _, constant := range route.Translation.Consts {
		assertUniqueTarget(t, route, targets, constant.To, "const")
	}
}

func assertUniqueTarget(t *testing.T, route ModelRoute, targets map[string]string, target string, source string) {
	t.Helper()
	if target == "" {
		return
	}
	if previous, ok := targets[target]; ok {
		t.Fatalf("route %q maps multiple params to vendor key %q: %s and %s", route.ID, target, previous, source)
	}
	targets[target] = source
}

func routeHasParam(route ModelRoute, id ParamID) bool {
	_, ok := routeParamByID(route, id)
	return ok
}

func routeParamByID(route ModelRoute, id ParamID) (RouteParam, bool) {
	for _, param := range route.CanonicalParams {
		if param.ID == id {
			return param, true
		}
	}
	return RouteParam{}, false
}
