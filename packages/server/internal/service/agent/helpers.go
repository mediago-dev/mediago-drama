package agent

import "github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"

// DiagnosticProjectID formats a project ID for logs and messages.
func DiagnosticProjectID(projectID string) string {
	return domain.DiagnosticProjectID(projectID)
}
