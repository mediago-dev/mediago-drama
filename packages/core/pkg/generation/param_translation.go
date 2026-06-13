package generation

import (
	"fmt"
	"strings"
)

// TranslateRouteParams converts canonical route params into provider-native params.
func TranslateRouteParams(route ModelRoute, params map[string]any) (map[string]any, error) {
	if len(params) == 0 && len(route.Translation.Consts) == 0 {
		return nil, nil
	}

	result := cloneAnyMap(params)
	defaults := routeParamDefaults(route.CanonicalParams)

	for _, join := range route.Translation.Joins {
		joined, ok, err := translateJoinParam(route, join, result, defaults)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		for _, id := range join.From {
			delete(result, string(id))
		}
		result[join.To] = joined
	}

	for _, move := range route.Translation.Moves {
		source := string(move.From)
		value, ok := result[source]
		if !ok || isEmptyParamValue(value) {
			continue
		}

		target := move.targetName()
		if target != source {
			delete(result, source)
		}
		result[target] = translateMoveValue(move, value)
	}

	for _, constant := range route.Translation.Consts {
		if constant.To == "" {
			continue
		}
		result[constant.To] = constant.Value
	}

	return result, nil
}

// UpgradeLegacyRouteParams converts known provider-native params back to canonical names.
func UpgradeLegacyRouteParams(route ModelRoute, params map[string]any) (map[string]any, error) {
	if len(params) == 0 {
		return nil, nil
	}

	result := cloneAnyMap(params)
	for _, move := range route.Translation.Moves {
		target := move.targetName()
		value, ok := result[target]
		if !ok || isEmptyParamValue(value) {
			continue
		}

		canonical := string(move.From)
		if target == canonical {
			result[canonical] = reverseMoveValue(move, value)
		} else if _, exists := result[canonical]; !exists {
			result[canonical] = reverseMoveValue(move, value)
		}
		if target != canonical {
			delete(result, target)
		}
	}

	for _, join := range route.Translation.Joins {
		if join.To == "" {
			continue
		}
		value, ok := result[join.To]
		if !ok || isEmptyParamValue(value) || hasAnyJoinSource(result, join.From) {
			continue
		}
		parts, ok := reverseJoinValue(join, value)
		if !ok {
			continue
		}
		for index, id := range join.From {
			if index < len(parts) {
				result[string(id)] = parts[index]
			}
		}
		delete(result, join.To)
	}

	normalized, err := NormalizeRouteParams(route, result)
	if err != nil {
		return result, err
	}

	return normalized, nil
}

func ValidateRouteParamTranslation(route ModelRoute, params map[string]any) error {
	_, err := TranslateRouteParams(route, params)
	return err
}

func translateJoinParam(
	route ModelRoute,
	join ParamJoin,
	params map[string]any,
	defaults map[ParamID]any,
) (any, bool, error) {
	if join.To == "" || len(join.From) == 0 {
		return nil, false, nil
	}

	parts := make([]string, 0, len(join.From))
	hasSource := false
	for _, id := range join.From {
		value, ok := params[string(id)]
		if ok && !isEmptyParamValue(value) {
			hasSource = true
		} else {
			value, ok = defaults[id]
		}
		if !ok || isEmptyParamValue(value) {
			return nil, false, fmt.Errorf("route %q parameter join %q is missing %q", route.ID, join.To, id)
		}

		part, ok := optionComparableString(value)
		if !ok {
			return nil, false, fmt.Errorf("route %q parameter join %q value for %q must be a string or number", route.ID, join.To, id)
		}
		parts = append(parts, part)
	}
	if !hasSource {
		return nil, false, nil
	}

	key := strings.Join(parts, "|")
	value, ok := join.Table[key]
	if !ok {
		return nil, false, fmt.Errorf("route %q parameter join %q has no mapping for %q", route.ID, join.To, key)
	}

	return value, true, nil
}

func translateMoveValue(move ParamMove, value any) any {
	if len(move.Values) == 0 {
		return value
	}

	key, ok := optionComparableString(value)
	if !ok {
		return value
	}
	if translated, ok := move.Values[key]; ok {
		return translated
	}

	return value
}

func reverseMoveValue(move ParamMove, value any) any {
	if len(move.Values) == 0 {
		return value
	}

	key, ok := optionComparableString(value)
	if !ok {
		return value
	}
	for canonical, vendor := range move.Values {
		if vendor == key {
			return canonical
		}
	}

	return value
}

func reverseJoinValue(join ParamJoin, value any) ([]string, bool) {
	text, ok := optionComparableString(value)
	if !ok {
		return nil, false
	}
	for key, vendorValue := range join.Table {
		if vendorValue == text {
			return strings.Split(key, "|"), true
		}
	}

	return nil, false
}

func (move ParamMove) targetName() string {
	if move.To != "" {
		return move.To
	}
	return string(move.From)
}

func routeParamDefaults(params []RouteParam) map[ParamID]any {
	defaults := make(map[ParamID]any, len(params))
	for _, param := range params {
		if !isEmptyParamValue(param.Default) {
			defaults[param.ID] = param.Default
		}
	}

	return defaults
}

func hasAnyJoinSource(params map[string]any, ids []ParamID) bool {
	for _, id := range ids {
		if value, ok := params[string(id)]; ok && !isEmptyParamValue(value) {
			return true
		}
	}

	return false
}

func cloneAnyMap(values map[string]any) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
