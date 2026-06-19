package agent

import "github.com/mediago-dev/mediago-drama/services/server/internal/domain"

// DiagnosticProjectID formats a project ID for logs and messages.
func DiagnosticProjectID(projectID string) string {
	return domain.DiagnosticProjectID(projectID)
}
