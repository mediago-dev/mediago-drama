package events

import "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"

type AgentEvent = agent.AgentEvent

const (
	ProjectBriefUpdatedEventType       = agent.ProjectBriefUpdatedEventType
	AgentDocumentSelectionSetEventType = agent.AgentDocumentSelectionSetEventType
	AgentUIEventType                   = agent.AgentUIEventType
)
