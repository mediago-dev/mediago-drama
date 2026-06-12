package app

import (
	"encoding/json"
	"log/slog"

	appmcp "github.com/mediago-dev/mediago-drama/packages/server/internal/app/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	serviceevents "github.com/mediago-dev/mediago-drama/packages/server/internal/service/events"
)

const (
	internalEventsPublishRoute = serviceevents.InternalEventsPublishRoute
	internalEventsPublishPath  = serviceevents.InternalEventsPublishPath
)

// PublishInternalAgentEvent validates and publishes an internal agent event payload.
func (handler *apiHandler) PublishInternalAgentEvent(raw json.RawMessage) (int, error) {
	event, status, err := serviceevents.DecodeInternalAgentEvent(raw, appmcp.CleanExternalProjectID)
	if err != nil {
		return status, err
	}
	slog.Debug(
		"internal agent event published",
		"type", event.Type,
		"project_id", domain.DiagnosticProjectID(event.ProjectID),
		"session_id", event.SessionID,
		"run_id", event.RunID,
	)
	handler.events.PublishEvent(event)
	return status, nil
}
