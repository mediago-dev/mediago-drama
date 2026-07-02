package generation

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

// ValidateRouteParams validates known request params against the route catalog.
func ValidateRouteParams(route ModelRoute, params map[string]any) error {
	_, err := NormalizeRouteParams(route, params)
	return err
}

// NormalizeRouteParams validates known route params and returns a normalized copy.
func NormalizeRouteParams(route ModelRoute, params map[string]any) (map[string]any, error) {
	if len(params) == 0 {
		return nil, nil
	}

	result := make(map[string]any, len(params))
	for key, value := range params {
		result[key] = value
	}
	for _, spec := range route.Params {
		value, ok := params[spec.Name]
		if !ok || isEmptyParamValue(value) {
			if spec.Required {
				return nil, fmt.Errorf("route %q parameter %q is required", route.ID, spec.Name)
			}
			continue
		}

		normalized, err := normalizeParamValue(spec, value)
		if err != nil {
			return nil, fmt.Errorf("route %q parameter %q: %w", route.ID, spec.Name, err)
		}
		result[spec.Name] = normalized
	}
	if err := validateRouteParamCombos(route, result); err != nil {
		return nil, err
	}

	return result, nil
}

func validateRouteParamCombos(route ModelRoute, params map[string]any) error {
	if len(route.Combos) == 0 {
		return nil
	}

	defaults := routeParamDefaults(route.CanonicalParams)
	for _, combo := range route.Combos {
		parts := make([]string, 0, len(combo.Params))
		hasSource := false
		for _, name := range combo.Params {
			value, ok := params[name]
			if ok && !isEmptyParamValue(value) {
				hasSource = true
			} else {
				value, ok = defaults[ParamID(name)]
			}
			if !ok || isEmptyParamValue(value) {
				return fmt.Errorf("route %q parameter combo %s is missing %q", route.ID, strings.Join(combo.Params, "+"), name)
			}

			part, ok := optionComparableString(value)
			if !ok {
				return fmt.Errorf("route %q parameter combo %s value for %q must be a string or number", route.ID, strings.Join(combo.Params, "+"), name)
			}
			parts = append(parts, part)
		}
		if !hasSource {
			continue
		}

		if !isParamComboAllowed(combo, parts) {
			return fmt.Errorf("route %q parameter combo %s has no mapping for %s", route.ID, strings.Join(combo.Params, "+"), strings.Join(parts, "|"))
		}
	}

	return nil
}

func isParamComboAllowed(combo ParamCombo, parts []string) bool {
	for _, allowed := range combo.Allowed {
		if len(allowed) != len(parts) {
			continue
		}
		matched := true
		for index, part := range parts {
			if allowed[index] != part {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}

	return false
}

func normalizeParamValue(spec ParamSpec, value any) (any, error) {
	switch spec.Type {
	case "select":
		return validateSelectParam(spec, value)
	case "number":
		return validateNumberParam(spec, value)
	case "boolean":
		return validateBooleanParam(value)
	case "text":
		return validateTextParam(value)
	default:
		return value, nil
	}
}

func validateSelectParam(spec ParamSpec, value any) (string, error) {
	selected, ok := optionComparableString(value)
	if !ok {
		return "", fmt.Errorf("must be a string or number")
	}
	if selected == "" && !spec.Required {
		return selected, nil
	}
	if len(spec.Options) == 0 {
		return selected, nil
	}

	for _, option := range spec.Options {
		if selected == option.Value {
			return selected, nil
		}
	}

	return "", fmt.Errorf("must be one of %s", optionValues(spec.Options))
}

func validateNumberParam(spec ParamSpec, value any) (float64, error) {
	number, ok := adapterutil.FloatValue(value)
	if !ok {
		return 0, fmt.Errorf("must be a number")
	}
	if spec.Min != nil && number < *spec.Min {
		return 0, fmt.Errorf("must be >= %s", formatNumber(*spec.Min))
	}
	if spec.Max != nil && number > *spec.Max {
		return 0, fmt.Errorf("must be <= %s", formatNumber(*spec.Max))
	}

	return number, nil
}

func validateBooleanParam(value any) (bool, error) {
	if result, ok := adapterutil.BoolValue(value); ok {
		return result, nil
	}

	return false, fmt.Errorf("must be a boolean")
}

func validateTextParam(value any) (string, error) {
	if result, ok := adapterutil.StringValue(value); ok {
		return strings.TrimSpace(result), nil
	}

	return "", fmt.Errorf("must be a string")
}

func optionComparableString(value any) (string, bool) {
	if text, ok := adapterutil.StringValue(value); ok {
		return strings.TrimSpace(text), true
	}
	if number, ok := adapterutil.FloatValue(value); ok {
		return formatNumber(number), true
	}

	return "", false
}

func optionValues(options []ParamOption) string {
	values := make([]string, 0, len(options))
	for _, option := range options {
		values = append(values, option.Value)
	}

	return strings.Join(values, ", ")
}

func isEmptyParamValue(value any) bool {
	if value == nil {
		return true
	}
	text, ok := adapterutil.StringValue(value)
	return ok && strings.TrimSpace(text) == ""
}

func formatNumber(value float64) string {
	if math.Trunc(value) == value {
		return strconv.FormatInt(int64(value), 10)
	}

	return strconv.FormatFloat(value, 'f', -1, 64)
}
