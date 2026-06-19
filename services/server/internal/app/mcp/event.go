package mcp

import (
	"context"
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	cliservice "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

func (adapter *Adapter) PublishAgentEvent(ctx context.Context, projectID string, event mediamcp.AgentDocumentEvent) error {
	_ = ctx
	if adapter == nil {
		return fmt.Errorf("mcp adapter is not configured")
	}
	if event == nil {
		return fmt.Errorf("agent document event is nil")
	}
	projectID = adapter.projectIDForAgentEvent(projectID)
	publisher := adapter.publisherForAgentEvent(projectID)
	if publisher == nil {
		return nil
	}
	switch typed := event.(type) {
	case mediamcp.AgentDocumentSelectionEvent:
		selection := adapter.decorateAgentDocumentSelection(projectID, typed)
		publisher.PublishEvent(agentEvent{
			ProjectID:         projectID,
			Type:              cliservice.AgentDocumentSelectionSetEventType,
			Message:           "已设置文档选区。",
			DocumentSelection: &selection,
		})
		return nil
	case *mediamcp.AgentDocumentSelectionEvent:
		if typed == nil {
			return fmt.Errorf("agent document selection event is nil")
		}
		selection := adapter.decorateAgentDocumentSelection(projectID, *typed)
		publisher.PublishEvent(agentEvent{
			ProjectID:         projectID,
			Type:              cliservice.AgentDocumentSelectionSetEventType,
			Message:           "已设置文档选区。",
			DocumentSelection: &selection,
		})
		return nil
	default:
		return fmt.Errorf("unsupported agent event type %T", event)
	}
}

func (adapter *Adapter) projectIDForAgentEvent(projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" && adapter != nil && adapter.document != nil {
		projectID = adapter.document.projectID
	}
	if adapter == nil {
		return projectID
	}
	cleaned, err := adapter.normalizeProjectID(projectID)
	if err == nil {
		return cleaned
	}
	return projectID
}

func (adapter *Adapter) publisherForAgentEvent(projectID string) EventPublisher {
	if adapter == nil {
		return nil
	}
	if adapter.events != nil {
		return adapter.events
	}
	if adapter.document != nil && (projectID == "" || projectID == adapter.document.projectID) {
		return adapter.document.config.Events
	}
	if adapter.external != nil {
		return adapter.external.events
	}
	return nil
}

func (adapter *Adapter) decorateAgentDocumentSelection(projectID string, event mediamcp.AgentDocumentSelectionEvent) mediamcp.AgentDocumentSelectionEvent {
	if adapter == nil || adapter.document == nil || (projectID != "" && projectID != adapter.document.projectID) {
		return event
	}
	if event.RunID == "" {
		event.RunID = adapter.document.config.RunID
	}
	if event.AgentTag == "" {
		event.AgentTag = firstNonEmpty(adapter.document.config.AgentTag, cliservice.DefaultAgentName)
	}
	return event
}
