package acp

import (
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/prompt"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"
)

type AgentRuntimeConfigResponse = agent.AgentRuntimeConfigResponse
type AgentRuntimeSelectConfig = agent.AgentRuntimeSelectConfig
type AgentRuntimeSelectOption = agent.AgentRuntimeSelectOption
type AgentRunRequest = agent.AgentRunRequest
type AgentRunResult = agent.AgentRunResult
type AgentFinalResponse = agent.AgentFinalResponse
type AgentA2UIPayload = agent.AgentA2UIPayload
type AgentDocumentContext = agent.AgentDocumentContext
type AgentACPConfigSelection = agent.AgentACPConfigSelection
type AgentACPEvent = agent.AgentACPEvent
type AgentACPContentBlock = agent.AgentACPContentBlock
type AgentACPLocation = agent.AgentACPLocation
type AgentACPPlanEntry = agent.AgentACPPlanEntry
type AgentACPPermissionRequest = agent.AgentACPPermissionRequest
type AgentACPRuntimeAlert = agent.AgentACPRuntimeAlert
type AgentACPToolCallSummary = agent.AgentACPToolCallSummary
type AgentACPPermissionOption = agent.AgentACPPermissionOption
type AgentEvent = agent.AgentEvent
type PromptBuildOptions = prompt.PromptBuildOptions

type agentEvent = agent.AgentEvent

const (
	ACPRuntimeLogKind = agent.ACPRuntimeLogKind
	AgentUIEventType  = agent.AgentUIEventType
)

var (
	BuildACPPrompt           = prompt.BuildACPPrompt
	TruncateAgentMessage     = prompt.TruncateAgentMessage
	FirstNonEmpty            = shared.FirstNonEmpty
	MustRandomID             = shared.MustRandomID
	ACPRuntimeLogText        = agent.ACPRuntimeLogText
	BuildAgentPermissionA2UI = agent.BuildAgentPermissionA2UI
	IsACPToolRuntimeLog      = agent.IsACPToolRuntimeLog
)
