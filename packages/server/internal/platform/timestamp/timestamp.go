// Package timestamp centralizes UTC RFC3339Nano timestamp handling.
//
// Persisted records and wire responses intentionally keep timestamps as
// strings, because the workspace JSON protocol and existing SQLite rows use
// RFC3339Nano text values.
package timestamp

import (
	"strings"
	"time"
)

// FormatRFC3339Nano formats t as a UTC RFC3339Nano timestamp string.
func FormatRFC3339Nano(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

// NowRFC3339Nano returns the current UTC timestamp in RFC3339Nano format.
func NowRFC3339Nano() string {
	return FormatRFC3339Nano(time.Now())
}

// ParseRFC3339Nano parses a trimmed RFC3339Nano timestamp string.
func ParseRFC3339Nano(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
}
