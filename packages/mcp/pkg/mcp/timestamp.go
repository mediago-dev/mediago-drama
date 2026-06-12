package mcp

import (
	"strings"
	"time"
)

// FormatTimestamp formats t as the RFC3339Nano timestamp string used by MCP wire records.
func FormatTimestamp(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

// ParseTimestamp parses a trimmed RFC3339Nano MCP wire timestamp.
func ParseTimestamp(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
}
