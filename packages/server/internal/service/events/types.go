package events

import "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"

type AgentEvent = agent.AgentEvent

const (
	ProjectBriefUpdatedEventType       = agent.ProjectBriefUpdatedEventType
	AgentDocumentSelectionSetEventType = agent.AgentDocumentSelectionSetEventType
	AgentUIEventType                   = agent.AgentUIEventType
)
