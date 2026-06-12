package mcp

import (
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	appevents "github.com/mediago-dev/mediago-drama/packages/server/internal/app/events"
	serviceagent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
	servicedocument "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

type agentEvent = appevents.Event
type agentEventContext = appevents.Context
type agentDocumentEditSnapshot = serviceagent.AgentDocumentEditSnapshot
type agentDocumentEditEvent = serviceagent.AgentDocumentEditEvent
type agentDocumentEditDelta = serviceagent.AgentDocumentEditDelta
type documentOperationLogRecord = servicedocument.DocumentOperationLogRecord
type documentToolApprovalRecord = servicedocument.DocumentToolApprovalRecord

// EventPublisher publishes agent events from MCP tools.
type EventPublisher = appevents.EventPublisher

func newAgentEventBus(context agentEventContext, publish func(agentEvent)) *appevents.Bus {
	return appevents.NewBus(context, publish)
}

func newProjectBriefUpdatedEvent(projectID string, brief servicedocument.ProjectBrief, message string) agentEvent {
	return appevents.NewProjectBriefUpdatedEvent(projectID, brief, message)
}

func mcpProjectBriefFromApp(brief servicedocument.ProjectBrief) mediamcp.ProjectBrief {
	return mediamcp.ProjectBrief{
		Medium:     brief.Medium,
		Genre:      brief.Genre,
		Pacing:     brief.Pacing,
		Audience:   brief.Audience,
		Tone:       brief.Tone,
		Style:      brief.Style,
		References: brief.References,
		Notes:      brief.Notes,
		UpdatedAt:  brief.UpdatedAt,
	}
}
