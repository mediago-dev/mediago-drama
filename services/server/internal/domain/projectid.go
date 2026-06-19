package domain

import (
	"fmt"
	"regexp"
	"strings"
)

// ValidProjectID matches persisted project identifiers.
var ValidProjectID = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,64}$`)

var unsafeProjectIDPattern = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// CleanProjectID normalizes user-provided project identifiers.
func CleanProjectID(id string) string {
	cleaned := unsafeProjectIDPattern.ReplaceAllString(strings.TrimSpace(id), "-")
	cleaned = strings.Trim(cleaned, ".-")
	return cleaned
}

// CleanExternalProjectID validates a project ID supplied to cross-project tools.
func CleanExternalProjectID(projectID string) (string, error) {
	raw := strings.TrimSpace(projectID)
	cleaned := CleanProjectID(raw)
	if cleaned == "" {
		return "", fmt.Errorf("projectId is required")
	}
	if cleaned != raw || !ValidProjectID.MatchString(cleaned) {
		return "", fmt.Errorf("invalid projectId %q; call list_projects and use the exact project id", projectID)
	}
	return cleaned, nil
}

// DiagnosticProjectID returns a compact, log-safe project identifier.
func DiagnosticProjectID(projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return "<empty>"
	}
	const maxRunes = 24
	runes := []rune(projectID)
	if len(runes) <= maxRunes {
		return projectID
	}
	return string(runes[:maxRunes]) + "..."
}
