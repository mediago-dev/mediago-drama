package app

import (
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/http/dto"
	serviceacp "github.com/mediago-dev/mediago-drama/packages/server/internal/service/acp"
	serviceagent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
	servicedocument "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
	servicemodel "github.com/mediago-dev/mediago-drama/packages/server/internal/service/model"
)

const defaultAgentRunTimeout = serviceagent.DefaultAgentRunTimeout

type ProjectBrief = servicemodel.ProjectBrief

type ProjectBriefUpdateMask = servicemodel.ProjectBriefUpdateMask

type createWorkspaceProjectRequest = servicedocument.CreateWorkspaceProjectRequest

type workspaceDocumentMetadataResponse = mediamcp.ListDocumentsOutput

type workspaceProjectsResponse = mediamcp.ProjectList

type workspaceProjectRecord = mediamcp.Project

type documentSnapshotRecord = servicedocument.DocumentSnapshotRecord

type documentOperationLogRecord = servicedocument.DocumentOperationLogRecord

type workspaceStateResponse = servicedocument.WorkspaceStateResponse

type workspaceStateRequest = servicedocument.WorkspaceStateRequest

type workspaceDocumentsResponse = servicedocument.WorkspaceDocumentsResponse

type createWorkspaceDocumentRequest = servicedocument.CreateWorkspaceDocumentRequest

type updateWorkspaceDocumentRequest = servicedocument.UpdateWorkspaceDocumentRequest

type deleteWorkspaceDocumentResponse = servicedocument.DeleteWorkspaceDocumentResponse

type documentToolApprovalRecord = servicedocument.DocumentToolApprovalRecord

type documentToolApprovalDecisionRequest = servicedocument.DocumentToolApprovalDecisionRequest

type sessionRequest = serviceagent.AgentSessionRequest

type sessionResponse = serviceagent.AgentSessionResponse

type agentSessionsResponse = serviceagent.AgentSessionsResponse

type agentSessionSummary = serviceagent.AgentSessionSummary

type agentSessionStatus = serviceagent.AgentSessionStatus

type agentPermissionDecisionRequest = serviceagent.AgentPermissionDecisionRequest

type agentChatStateResponse = serviceagent.AgentChatStateResponse

type agentChatAppendRequest = serviceagent.AgentChatAppendRequest

type agentChatMessageRecord = serviceagent.AgentChatMessageRecord

type agentChatActivityRecord = serviceagent.AgentChatActivityRecord

type agentConversationRecord = serviceagent.AgentConversationRecord

type agentRuntimeConfigResponse = serviceagent.AgentRuntimeConfigResponse

type agentRuntimeSelectConfig = serviceagent.AgentRuntimeSelectConfig

type agentRuntimeSelectOption = serviceagent.AgentRuntimeSelectOption

type agentSessionService = serviceagent.SessionService

type agentRunner = serviceagent.AgentRunner

type agentRun = serviceagent.AgentRun

type agentRunRequest = serviceagent.AgentRunRequest

type agentRunResult = serviceagent.AgentRunResult

type agentRunStartOptions = serviceagent.AgentRunStartOptions

type agentRunFinishResult = serviceagent.AgentRunFinishResult

type agentFinalResponse = serviceagent.AgentFinalResponse

type agentEvent = serviceagent.AgentEvent

type agentEventContext = serviceagent.AgentEventContext

type agentACPEvent = serviceagent.AgentACPEvent

type agentACPContentBlock = serviceagent.AgentACPContentBlock

type agentACPLocation = serviceagent.AgentACPLocation

type agentACPPlanEntry = serviceagent.AgentACPPlanEntry

type agentACPPermissionRequest = serviceagent.AgentACPPermissionRequest

type agentDocumentEditEvent = serviceagent.AgentDocumentEditEvent

type agentDocumentEditSnapshot = serviceagent.AgentDocumentEditSnapshot

type agentDocumentEditDelta = serviceagent.AgentDocumentEditDelta

type documentEditStreamRecord = servicedocument.DocumentEditStreamRecord

type agentDocumentProposal = serviceagent.AgentDocumentProposal

type messageRequest = serviceagent.AgentMessageRequest

type messageResponse = serviceagent.AgentMessageResponse

type agentACPConfigSelection = serviceagent.AgentACPConfigSelection

type agentDocumentContext = serviceagent.AgentDocumentContext

type agentScopedEditContext = serviceagent.AgentScopedEditContext

type documentOperationsRequest = servicedocument.DocumentOperationsRequest

type documentOperationsResponse = servicedocument.DocumentOperationsResponse

type documentOperationRuntime = servicedocument.DocumentOperationRuntime

type documentOperationRecord = servicedocument.DocumentOperationRecord

type documentOperationTarget = servicedocument.DocumentOperationTarget

type generationAsset = dto.GenerationAsset

type generationUsage = dto.GenerationUsage

type generationModelsResponse = dto.GenerationModelsResponse

type generationMessageRequest = dto.GenerationMessageRequest

type generationMessageResponse = dto.GenerationMessageResponse

type generationTaskRecord = dto.GenerationTaskRecord

type generationTaskAttemptRecord = dto.GenerationTaskAttemptRecord

type generationTasksResponse = dto.GenerationTasksResponse

type workspaceVersionConflictError = servicedocument.WorkspaceVersionConflictError

func mediaGoDramaMCPToolName(toolName string) string {
	return serviceacp.MediaGoDramaMCPToolName(toolName)
}

func mcpProjectBriefFromApp(brief ProjectBrief) mediamcp.ProjectBrief {
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
