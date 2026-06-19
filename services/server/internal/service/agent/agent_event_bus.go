package agent

import (
	"log/slog"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

// AgentEventContext decorates agent events with run and agent metadata.
type AgentEventContext struct {
	SessionID string
	ProjectID string
	RunID     string
	AgentTag  string
}

// AgentEventBus decorates and publishes agent events for one run context.
type AgentEventBus struct {
	context AgentEventContext
	publish func(AgentEvent)
}

// NewAgentEventBus returns a run-scoped event publisher.
func NewAgentEventBus(context AgentEventContext, publish func(AgentEvent)) *AgentEventBus {
	if publish == nil {
		return nil
	}
	return &AgentEventBus{
		context: NormalizeAgentEventContext(context),
		publish: publish,
	}
}

// PublishEvent decorates and publishes an agent event.
func (bus *AgentEventBus) PublishEvent(event AgentEvent) {
	if bus == nil || bus.publish == nil {
		return
	}

	event = bus.Decorate(event)
	slog.Debug(
		"agent event publishing",
		"session_id", event.SessionID,
		"project_id", DiagnosticProjectID(event.ProjectID),
		"run_id", event.RunID,
		"type", event.Type,
		"message_len", len(event.Message),
	)
	bus.publish(event)
}

// Decorate fills missing run, agent, and timestamp fields on an event.
func (bus *AgentEventBus) Decorate(event AgentEvent) AgentEvent {
	if event.ID == "" {
		event.ID = shared.MustRandomID("event")
	}
	if event.SessionID == "" {
		event.SessionID = bus.context.SessionID
	}
	if event.ProjectID == "" {
		event.ProjectID = bus.context.ProjectID
	}
	if event.RunID == "" {
		event.RunID = bus.context.RunID
	}
	if event.CreatedAt == "" {
		event.CreatedAt = timestamp.NowRFC3339Nano()
	}
	if event.DocumentEdit != nil {
		if event.DocumentEdit.RunID == "" {
			event.DocumentEdit.RunID = event.RunID
		}
		if event.DocumentEdit.AgentTag == "" {
			event.DocumentEdit.AgentTag = bus.context.AgentTag
		}
	}
	if event.DocumentSelection != nil {
		if event.DocumentSelection.RunID == "" {
			event.DocumentSelection.RunID = event.RunID
		}
		if event.DocumentSelection.AgentTag == "" {
			event.DocumentSelection.AgentTag = bus.context.AgentTag
		}
	}
	return event
}

// PublishProjectBriefUpdated publishes a project brief update event.
func (bus *AgentEventBus) PublishProjectBriefUpdated(projectID string, brief ProjectBrief) {
	if bus == nil {
		return
	}
	bus.PublishEvent(NewProjectBriefUpdatedEvent(projectID, brief, "项目设定已更新。"))
}

// NewProjectBriefUpdatedEvent creates a project brief update event.
func NewProjectBriefUpdatedEvent(projectID string, brief ProjectBrief, message string) AgentEvent {
	if strings.TrimSpace(message) == "" {
		message = "项目设定已更新。"
	}
	return AgentEvent{
		ID:           shared.MustRandomID("event"),
		ProjectID:    domain.CleanProjectID(projectID),
		Type:         ProjectBriefUpdatedEventType,
		Message:      message,
		ProjectBrief: &brief,
		CreatedAt:    timestamp.NowRFC3339Nano(),
	}
}

// NormalizeAgentEventContext cleans a run-scoped event context.
func NormalizeAgentEventContext(context AgentEventContext) AgentEventContext {
	context.SessionID = strings.TrimSpace(context.SessionID)
	context.ProjectID = domain.CleanProjectID(context.ProjectID)
	context.RunID = strings.TrimSpace(context.RunID)
	context.AgentTag = strings.TrimSpace(context.AgentTag)
	if context.AgentTag == "" {
		context.AgentTag = DefaultAgentName
	}
	return context
}
