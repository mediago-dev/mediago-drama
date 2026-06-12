package app

import (
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/app/events"
)

func (handler *apiHandler) newAgentEventBus(context events.Context) *events.Bus {
	return events.NewBus(context, handler.events.Publish)
}

func (handler *apiHandler) publishProjectBriefUpdated(projectID string, brief ProjectBrief) {
	handler.events.Publish(events.NewProjectBriefUpdatedEvent(projectID, brief, "项目设定已更新。"))
}

// NewAgentEventBus creates a scoped event bus for MCP runtime config.
func (handler *apiHandler) NewAgentEventBus(context events.Context) events.EventPublisher {
	return handler.newAgentEventBus(context)
}
