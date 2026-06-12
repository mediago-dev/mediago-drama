package events

import (
	serviceagent "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
	servicemodel "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/model"
)

// Context carries the agent/session identity used to decorate events.
type Context = serviceagent.AgentEventContext

// Bus decorates and publishes events for a single agent run.
type Bus struct {
	bus *serviceagent.AgentEventBus
}

// NewBus creates an agent event bus for a run context.
func NewBus(context Context, publish func(Event)) *Bus {
	bus := serviceagent.NewAgentEventBus(context, publish)
	if bus == nil {
		return nil
	}
	return &Bus{bus: bus}
}

// PublishEvent publishes a decorated event.
func (bus *Bus) PublishEvent(event Event) {
	if bus == nil || bus.bus == nil {
		return
	}
	bus.bus.PublishEvent(event)
}

// PublishProjectBriefUpdated publishes a project brief update event.
func (bus *Bus) PublishProjectBriefUpdated(projectID string, brief servicemodel.ProjectBrief) {
	if bus == nil || bus.bus == nil {
		return
	}
	bus.bus.PublishProjectBriefUpdated(projectID, brief)
}

// NewProjectBriefUpdatedEvent creates a project brief update event.
func NewProjectBriefUpdatedEvent(projectID string, brief servicemodel.ProjectBrief, message string) Event {
	return serviceagent.NewProjectBriefUpdatedEvent(projectID, brief, message)
}

// NormalizeContext normalizes agent event identity fields.
func NormalizeContext(context Context) Context {
	return serviceagent.NormalizeAgentEventContext(context)
}
