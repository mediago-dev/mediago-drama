package codex

import (
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

type AgentRuntimeConfigResponse = agent.AgentRuntimeConfigResponse
type AgentRuntimeSelectConfig = agent.AgentRuntimeSelectConfig
type AgentRuntimeSelectOption = agent.AgentRuntimeSelectOption
type AgentRunRequest = agent.AgentRunRequest
type AgentRunResult = agent.AgentRunResult
type AgentFinalResponse = agent.AgentFinalResponse
type AgentA2UIPayload = agent.AgentA2UIPayload
type AgentDocumentContext = agent.AgentDocumentContext
type AgentRuntimeConfigSelection = agent.AgentRuntimeConfigSelection
type AgentRuntimeEvent = agent.AgentRuntimeEvent
type AgentRuntimeContentBlock = agent.AgentRuntimeContentBlock
type AgentRuntimeLocation = agent.AgentRuntimeLocation
type AgentRuntimePlanEntry = agent.AgentRuntimePlanEntry
type AgentRuntimePermissionRequest = agent.AgentRuntimePermissionRequest
type AgentRuntimeAlert = agent.AgentRuntimeAlert
type AgentRuntimeToolCallSummary = agent.AgentRuntimeToolCallSummary
type AgentRuntimePermissionOption = agent.AgentRuntimePermissionOption
type AgentEvent = agent.AgentEvent
type AgentMessagePhase = agent.AgentMessagePhase
type PromptBuildOptions = prompt.PromptBuildOptions

type agentEvent = agent.AgentEvent

const (
	RuntimeLogKind   = agent.RuntimeLogKind
	AgentUIEventType = agent.AgentUIEventType
)

var (
	BuildRuntimePrompt       = prompt.BuildRuntimePrompt
	BuildRuntimeUserPrompt   = prompt.BuildRuntimeUserPrompt
	TruncateAgentMessage     = prompt.TruncateAgentMessage
	FirstNonEmpty            = shared.FirstNonEmpty
	MustRandomID             = shared.MustRandomID
	RuntimeLogText           = agent.RuntimeLogText
	BuildAgentPermissionA2UI = agent.BuildAgentPermissionA2UI
	IsRuntimeToolRuntimeLog  = agent.IsRuntimeToolRuntimeLog
	normalizeAgentEvent      = agent.NormalizeAgentEventSemantics
)

type AgentInputQuestion = agent.AgentInputQuestion
type AgentInputOption = agent.AgentInputOption
