package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const (
	// InternalEventsPublishRoute is the internal agent event publish route.
	InternalEventsPublishRoute = "/internal/events/publish"
	// InternalEventsPublishPath is the full API path for internal agent events.
	InternalEventsPublishPath = "/api/v1" + InternalEventsPublishRoute
)

// IsInternalPublishEventType reports whether an event may be published through
// the internal agent event bridge.
func IsInternalPublishEventType(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case "agent.document.edit.started",
		"agent.document.edit.delta",
		"agent.document.edit.checkpoint",
		"agent.document.edit.completed",
		"agent.document.edit.failed",
		AgentDocumentSelectionSetEventType,
		AgentUIEventType:
		return true
	default:
		return false
	}
}

// DecodeInternalAgentEvent validates and decodes an internal event bridge payload.
func DecodeInternalAgentEvent(raw json.RawMessage, cleanProjectID func(string) (string, error)) (AgentEvent, int, error) {
	if len(raw) == 0 {
		return AgentEvent{}, http.StatusBadRequest, fmt.Errorf("empty event payload")
	}
	var event AgentEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return AgentEvent{}, http.StatusBadRequest, fmt.Errorf("invalid json body: %w", err)
	}
	if !IsInternalPublishEventType(event.Type) {
		return AgentEvent{}, http.StatusBadRequest, fmt.Errorf("unsupported internal event type")
	}
	if cleanProjectID != nil {
		projectID, err := cleanProjectID(event.ProjectID)
		if err != nil {
			return AgentEvent{}, http.StatusBadRequest, err
		}
		event.ProjectID = projectID
	}
	return event, http.StatusNoContent, nil
}

// IsGuaranteedAgentEvent reports whether an event must be delivered even when
// subscriber buffers are full.
func IsGuaranteedAgentEvent(eventType string) bool {
	switch eventType {
	case "agent.message.completed",
		AgentUIEventType,
		"agent.patch.proposed",
		AgentDocumentSelectionSetEventType,
		"agent.document.edit.started",
		"agent.document.edit.delta",
		"agent.document.edit.checkpoint",
		"agent.document.edit.completed",
		"agent.document.edit.failed",
		ProjectBriefUpdatedEventType,
		"agent.run.cancelled",
		"agent.run.failed",
		"agent.run.completed":
		return true
	default:
		return false
	}
}

// IsGuaranteedAgentEventPayload reports whether a concrete event must be
// delivered even when subscriber buffers are full.
func IsGuaranteedAgentEventPayload(event AgentEvent) bool {
	if strings.TrimSpace(event.Type) == "agent.acp" &&
		event.ACP != nil &&
		strings.TrimSpace(event.ACP.Kind) == "permissionRequest" {
		return true
	}
	return IsGuaranteedAgentEvent(event.Type)
}
