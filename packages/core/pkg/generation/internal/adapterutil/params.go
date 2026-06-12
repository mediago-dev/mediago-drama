package adapterutil

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func ValueOrDefault(value string, fallback string) string {
	if value != "" {
		return value
	}

	return fallback
}

func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}

func JoinTaskID(prefix string, taskID string) string {
	if prefix == "" {
		return taskID
	}

	return prefix + ":" + taskID
}

func SplitTaskID(id string) (string, string) {
	prefix, taskID, ok := strings.Cut(id, ":")
	if !ok {
		return "", id
	}

	return prefix, taskID
}

func ParamString(params map[string]any, key string) string {
	if len(params) == 0 {
		return ""
	}
	value, ok := StringValue(params[key])
	if !ok {
		return ""
	}

	return strings.TrimSpace(value)
}

func StringValue(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case fmt.Stringer:
		return typed.String(), true
	default:
		return "", false
	}
}

func ParamInt(params map[string]any, key string, fallback int) int {
	if len(params) == 0 {
		return fallback
	}
	value, ok := IntValue(params[key])
	if !ok {
		return fallback
	}

	return value
}

func ParamIntPointer(params map[string]any, key string) *int {
	if len(params) == 0 {
		return nil
	}
	value, ok := IntValue(params[key])
	if !ok {
		return nil
	}

	return &value
}

func IntValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int8:
		return int(typed), true
	case int16:
		return int(typed), true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case uint:
		return int(typed), true
	case uint8:
		return int(typed), true
	case uint16:
		return int(typed), true
	case uint32:
		return int(typed), true
	case uint64:
		return int(typed), true
	case float32:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed), true
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed, true
		}
	}

	return 0, false
}

func FloatValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int8:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint8:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case float32:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		parsed, err := typed.Float64()
		if err == nil {
			return parsed, true
		}
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return parsed, true
		}
	}

	return 0, false
}

func ParamBool(params map[string]any, key string, fallback bool) bool {
	if len(params) == 0 {
		return fallback
	}
	value, ok := BoolValue(params[key])
	if !ok {
		return fallback
	}

	return value
}

func ParamBoolValueOnly(params map[string]any, key string) (bool, bool) {
	if len(params) == 0 {
		return false, false
	}

	return BoolValue(params[key])
}

func BoolValue(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on":
			return true, true
		case "false", "0", "no", "off":
			return false, true
		}
	}

	return false, false
}

func BoolParamValue(params map[string]any, key string, value *bool, fallback bool) bool {
	if value != nil {
		return *value
	}

	return ParamBool(params, key, fallback)
}

func BoolParamPointer(params map[string]any, key string, value *bool, fallback bool) *bool {
	resolved := BoolParamValue(params, key, value, fallback)
	return &resolved
}

func CompactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}

	return result
}

func StringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}

	value, _ := values[key].(string)
	return value
}

func NormalizeVideoStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success", "succeed", "succeeded", "completed", "complete":
		return "completed"
	case "failed", "fail", "error", "cancelled", "canceled", "expired":
		return "failed"
	case "in_progress", "processing", "running", "preparing":
		return "running"
	case "queueing", "pending", "submitted", "queued":
		return "submitted"
	default:
		return status
	}
}
