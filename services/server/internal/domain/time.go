package domain

import (
	"strings"
	"time"
)

// TimeFromString parses persisted/wire RFC3339Nano timestamps for GORM models.
func TimeFromString(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

// StringFromTime formats a GORM timestamp for wire records.
func StringFromTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

// StringPtr stores optional text as NULL when empty.
func StringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

// StringValue reads nullable model text as an empty wire value.
func StringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
