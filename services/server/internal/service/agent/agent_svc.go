package agent

import (
	"encoding/json"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

// ProjectBriefUpdatedEventType is emitted when a project brief changes.
const ProjectBriefUpdatedEventType = "project.brief.updated"

// AgentDocumentSelectionSetEventType is emitted when an agent updates document selection.
const AgentDocumentSelectionSetEventType = "agent.document.selection.set"

// AgentUIEventType is emitted when an agent returns an A2UI surface payload.
const AgentUIEventType = "agent.ui"

type ProjectBrief = model.ProjectBrief

// AgentSessionRequest creates or reuses an agent session.
type AgentSessionRequest struct {
	ProjectID  string `json:"projectId,omitempty"`
	NewSession bool   `json:"newSession,omitempty"`
}

// AgentSessionResponse returns an agent session ID.
type AgentSessionResponse struct {
	SessionID string `json:"sessionId"`
}

// AgentSessionSummary is a list item for an agent session.
type AgentSessionSummary struct {
	SessionID   string `json:"sessionId"`
	ProjectID   string `json:"projectId,omitempty"`
	Title       string `json:"title,omitempty"`
	LastStatus  string `json:"lastStatus,omitempty"`
	LastMessage string `json:"lastMessage,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	Running     bool   `json:"running"`
}

// AgentSessionsResponse lists agent sessions.
type AgentSessionsResponse struct {
	Sessions []AgentSessionSummary `json:"sessions"`
}

// AgentSessionStatus is the current run status for an agent session.
type AgentSessionStatus struct {
	SessionID          string                      `json:"sessionId"`
	ProjectID          string                      `json:"-"`
	RunID              string                      `json:"-"`
	Running            bool                        `json:"running"`
	LastStatus         string                      `json:"lastStatus,omitempty"`
	LastMessage        string                      `json:"lastMessage,omitempty"`
	PendingPermissions []AgentACPPermissionRequest `json:"pendingPermissions,omitempty"`
}

// AgentPermissionDecisionRequest resolves one ACP permission request.
type AgentPermissionDecisionRequest struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	OptionID  string `json:"optionId,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
}

// AgentDocumentContext is the compact document context sent to agent runtimes.
type AgentDocumentContext struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Category  string `json:"category,omitempty"`
	ParentID  string `json:"parentId,omitempty"`
	SortOrder int    `json:"sortOrder,omitempty"`
	Version   int    `json:"version,omitempty"`
}

// AgentChatStateResponse is the full chat projection returned to the workspace UI.
type AgentChatStateResponse struct {
	ProjectID          string                      `json:"projectId,omitempty"`
	SessionID          string                      `json:"sessionId,omitempty"`
	Running            bool                        `json:"running,omitempty"`
	Messages           []AgentChatMessageRecord    `json:"messages"`
	Activity           []AgentChatActivityRecord   `json:"activity"`
	PendingPermissions []AgentACPPermissionRequest `json:"pendingPermissions,omitempty"`
	LastEventID        string                      `json:"lastEventId,omitempty"`
	UpdatedAt          string                      `json:"updatedAt,omitempty"`
}

// AgentChatAppendRequest appends chat messages.
type AgentChatAppendRequest struct {
	ProjectID string                   `json:"projectId,omitempty"`
	Messages  []AgentChatMessageRecord `json:"messages"`
}

// AgentChatMessageRecord is a persisted chat message.
type AgentChatMessageRecord struct {
	ID        string            `json:"id"`
	TurnID    string            `json:"turnId,omitempty"`
	ItemID    string            `json:"itemId,omitempty"`
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	Kind      string            `json:"kind,omitempty"`
	Phase     AgentMessagePhase `json:"phase,omitempty"`
	Title     string            `json:"title,omitempty"`
	CreatedAt string            `json:"createdAt,omitempty"`
	Status    string            `json:"status,omitempty"`
	Metadata  map[string]any    `json:"metadata,omitempty"`
}

// AgentMessagePhase identifies whether an assistant item belongs to the
// collapsible process stream or the final answer.
type AgentMessagePhase string

const (
	// AgentMessagePhaseCommentary marks reasoning, plans, tools, and other
	// intermediate process items.
	AgentMessagePhaseCommentary AgentMessagePhase = "commentary"
	// AgentMessagePhaseFinalAnswer marks user-visible final response content.
	AgentMessagePhaseFinalAnswer AgentMessagePhase = "final_answer"
)

// AgentChatActivityRecord is a derived chat activity item.
type AgentChatActivityRecord struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// AgentConversationRecord is a projected agent run conversation.
type AgentConversationRecord struct {
	RunID              string                   `json:"runId"`
	Name               string                   `json:"name,omitempty"`
	Prompt             string                   `json:"prompt,omitempty"`
	Status             string                   `json:"status"`
	Messages           []AgentChatMessageRecord `json:"messages"`
	StreamingMessageID string                   `json:"streamingMessageId,omitempty"`
	Children           []string                 `json:"children"`
	CreatedAt          string                   `json:"createdAt"`
	UpdatedAt          string                   `json:"updatedAt"`
}

// AgentRuntimeConfigResponse describes runtime-selectable agent configuration.
type AgentRuntimeConfigResponse struct {
	Model      *AgentRuntimeSelectConfig `json:"model,omitempty"`
	Reasoning  *AgentRuntimeSelectConfig `json:"reasoning,omitempty"`
	Permission *AgentRuntimeSelectConfig `json:"permission,omitempty"`
}

// AgentRuntimeSelectConfig is one runtime select control.
type AgentRuntimeSelectConfig struct {
	ConfigID     string                     `json:"configId,omitempty"`
	Name         string                     `json:"name,omitempty"`
	Source       string                     `json:"source,omitempty"`
	CurrentValue string                     `json:"currentValue,omitempty"`
	Options      []AgentRuntimeSelectOption `json:"options"`
}

// AgentRuntimeSelectOption is an option inside a runtime select control.
type AgentRuntimeSelectOption struct {
	Value       string `json:"value"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// AgentEvent is the event projection streamed to the workspace UI.
type AgentEvent struct {
	ID                string                                `json:"id"`
	Sequence          int64                                 `json:"sequence,omitempty"`
	SessionID         string                                `json:"sessionId"`
	ProjectID         string                                `json:"projectId,omitempty"`
	Type              string                                `json:"type"`
	Message           string                                `json:"message"`
	CreatedAt         string                                `json:"createdAt"`
	RunID             string                                `json:"runId,omitempty"`
	TurnID            string                                `json:"turnId,omitempty"`
	ItemID            string                                `json:"itemId,omitempty"`
	Phase             AgentMessagePhase                     `json:"phase,omitempty"`
	Delta             string                                `json:"delta,omitempty"`
	Content           string                                `json:"content,omitempty"`
	ACPSessionID      string                                `json:"acpSessionId,omitempty"`
	ACP               *AgentACPEvent                        `json:"acp,omitempty"`
	DocumentEdit      *AgentDocumentEditEvent               `json:"documentEdit,omitempty"`
	DocumentSelection *mediamcp.AgentDocumentSelectionEvent `json:"documentSelection,omitempty"`
	DocumentProposal  *AgentDocumentProposal                `json:"documentProposal,omitempty"`
	Documents         []mediamcp.WorkspaceDocument          `json:"documents,omitempty"`
	ProjectBrief      *ProjectBrief                         `json:"projectBrief,omitempty"`
	A2UI              *AgentA2UIPayload                     `json:"a2ui,omitempty"`
	Form              *AgentFormPayload                     `json:"form,omitempty"`
	// Metadata carries display data projected onto the chat message record,
	// e.g. attachment cards and mention/skill chips for user messages.
	Metadata map[string]any `json:"metadata,omitempty"`
}

// AgentFormPayload describes a native parameter-form card pushed to the run
// timeline; Fields carries the selection service's form field specs verbatim.
type AgentFormPayload struct {
	SelectionID string          `json:"selectionId"`
	ProjectID   string          `json:"projectId,omitempty"`
	Title       string          `json:"title"`
	Prompt      string          `json:"prompt,omitempty"`
	SubmitLabel string          `json:"submitLabel,omitempty"`
	Fields      json.RawMessage `json:"fields"`
	Intent      json.RawMessage `json:"intent,omitempty"`
}

// AgentA2UIPayload describes A2UI messages returned by an agent.
type AgentA2UIPayload struct {
	Version   string          `json:"version,omitempty"`
	SurfaceID string          `json:"surfaceId,omitempty"`
	Messages  json.RawMessage `json:"messages"`
	Intent    json.RawMessage `json:"intent,omitempty"`
}

// AgentACPEvent describes one ACP runtime event.
type AgentACPEvent struct {
	Kind              string                     `json:"kind"`
	ToolCallID        string                     `json:"toolCallId,omitempty"`
	ToolKind          string                     `json:"toolKind,omitempty"`
	Title             string                     `json:"title,omitempty"`
	Status            string                     `json:"status,omitempty"`
	Locations         []AgentACPLocation         `json:"locations,omitempty"`
	RawInput          json.RawMessage            `json:"rawInput,omitempty"`
	RawOutput         json.RawMessage            `json:"rawOutput,omitempty"`
	Content           []AgentACPContentBlock     `json:"content,omitempty"`
	Thought           string                     `json:"thought,omitempty"`
	Plan              []AgentACPPlanEntry        `json:"plan,omitempty"`
	PermissionRequest *AgentACPPermissionRequest `json:"permissionRequest,omitempty"`
	RuntimeAlert      *AgentACPRuntimeAlert      `json:"runtimeAlert,omitempty"`
}

// AgentACPRuntimeAlert describes an important ACP runtime alert shown in chat.
type AgentACPRuntimeAlert struct {
	Severity string `json:"severity,omitempty"`
	Title    string `json:"title"`
	Message  string `json:"message"`
	Reason   string `json:"reason,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

// AgentACPPermissionRequest describes an ACP per-tool permission request.
type AgentACPPermissionRequest struct {
	RequestID string                     `json:"requestId"`
	ToolCall  *AgentACPToolCallSummary   `json:"toolCall,omitempty"`
	Options   []AgentACPPermissionOption `json:"options"`
	CreatedAt string                     `json:"createdAt,omitempty"`
}

// AgentACPToolCallSummary describes the tool asking for permission.
type AgentACPToolCallSummary struct {
	ID     string `json:"id,omitempty"`
	Title  string `json:"title,omitempty"`
	Kind   string `json:"kind,omitempty"`
	Status string `json:"status,omitempty"`
}

// AgentACPPermissionOption describes one selectable permission outcome.
type AgentACPPermissionOption struct {
	OptionID string `json:"optionId"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
}

// AgentACPContentBlock describes ACP tool-call content.
type AgentACPContentBlock struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	Path       string `json:"path,omitempty"`
	OldText    string `json:"oldText,omitempty"`
	NewText    string `json:"newText,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	TerminalID string `json:"terminalId,omitempty"`
}

// AgentACPLocation describes a source location from ACP.
type AgentACPLocation struct {
	Path string `json:"path"`
	Line *int   `json:"line,omitempty"`
}

// AgentACPPlanEntry describes one ACP plan entry.
type AgentACPPlanEntry struct {
	Content  string `json:"content"`
	Status   string `json:"status"`
	Priority string `json:"priority,omitempty"`
}

// AgentDocumentEditEvent describes an agent document edit event.
type AgentDocumentEditEvent struct {
	DocumentID string                      `json:"documentId"`
	StreamID   string                      `json:"streamId,omitempty"`
	Title      string                      `json:"title,omitempty"`
	ParentID   string                      `json:"parentId,omitempty"`
	SortOrder  int                         `json:"sortOrder,omitempty"`
	Mode       string                      `json:"mode,omitempty"`
	Delta      string                      `json:"delta,omitempty"`
	Content    string                      `json:"content,omitempty"`
	AnchorText string                      `json:"anchorText,omitempty"`
	BlockID    string                      `json:"blockId,omitempty"`
	Op         string                      `json:"op,omitempty"`
	Range      *mediamcp.DocumentTextRange `json:"range,omitempty"`
	Summary    string                      `json:"summary,omitempty"`
	Status     string                      `json:"status,omitempty"`
	UpdatedAt  string                      `json:"updatedAt,omitempty"`
	RunID      string                      `json:"runId,omitempty"`
	AgentTag   string                      `json:"agentTag,omitempty"`
}

// AgentDocumentProposal describes a proposed full document update.
type AgentDocumentProposal struct {
	DocumentID string `json:"documentId"`
	Title      string `json:"title,omitempty"`
	Content    string `json:"content,omitempty"`
	Summary    string `json:"summary,omitempty"`
}

// AgentReference mirrors a structured document, section, or project asset mention from the workspace UI.
type AgentReference struct {
	Kind       string `json:"kind"`
	DocumentID string `json:"documentId"`
	AssetID    string `json:"assetId,omitempty"`
	AssetKind  string `json:"assetKind,omitempty"`
	BlockID    string `json:"blockId,omitempty"`
	MIMEType   string `json:"mimeType,omitempty"`
	Title      string `json:"title"`
	Category   string `json:"category,omitempty"`
	URL        string `json:"url,omitempty"`
}

// AgentMessageRequest starts an agent run.
type AgentMessageRequest struct {
	SessionID string `json:"sessionId"`
	ProjectID string `json:"projectId,omitempty"`
	Prompt    string `json:"prompt"`
	// DisplayPrompt is the user-facing text shown in the chat transcript; the
	// machine Prompt may carry extra instructions (reference tokens, skill
	// loading directives) that must not render in the UI.
	DisplayPrompt string `json:"displayPrompt,omitempty"`
	// DisplayMetadata carries structured rendering data for the transcript
	// bubble (attachment cards, mention/skill chips). Stored verbatim on the
	// projected user message.
	DisplayMetadata map[string]any             `json:"displayMetadata,omitempty"`
	AgentTag        string                     `json:"-"`
	SystemPrompt    string                     `json:"-"`
	AnchorText      string                     `json:"anchorText,omitempty"`
	CommentID       string                     `json:"commentId,omitempty"`
	Comments        []mediamcp.DocumentComment `json:"comments,omitempty"`
	Document        *AgentDocumentContext      `json:"document,omitempty"`
	Documents       []AgentDocumentContext     `json:"documents,omitempty"`
	References      []AgentReference           `json:"references,omitempty"`
	SelectionText   string                     `json:"selectionText,omitempty"`
	Model           AgentACPConfigSelection    `json:"model,omitempty"`
	Reasoning       AgentACPConfigSelection    `json:"reasoning,omitempty"`
	Permission      AgentACPConfigSelection    `json:"permission,omitempty"`
}

// AgentRunRequest is the normalized runtime request passed to an agent runner.
type AgentRunRequest struct {
	SessionID             string
	RunID                 string
	ACPSessionID          string
	ACPInstructionHash    string
	ProjectID             string
	Prompt                string
	AgentTag              string
	SystemPrompt          string
	AnchorText            string
	CommentID             string
	Comments              []mediamcp.DocumentComment
	Document              *AgentDocumentContext
	Documents             []AgentDocumentContext
	References            []AgentReference
	SelectionText         string
	WorkspaceDir          string
	ProjectDir            string
	WorkingDir            string
	BridgeURL             string
	BridgeToken           string
	DocumentMCPConfigPath string
	Model                 AgentACPConfigSelection
	Reasoning             AgentACPConfigSelection
	Permission            AgentACPConfigSelection
}

// AgentRunResult is returned by an agent runner.
type AgentRunResult struct {
	ACPSessionID       string
	ACPInstructionHash string
	Message            string
	MessageItemID      string
	StreamedMessage    bool
	DocumentProposal   *AgentDocumentProposal
	A2UI               *AgentA2UIPayload
}

// AgentFinalResponse is the JSON shape an ACP agent may emit at the end of a turn.
type AgentFinalResponse struct {
	Message          string                 `json:"message"`
	ProposedDocument *AgentDocumentProposal `json:"proposedDocument"`
	A2UI             *AgentA2UIPayload      `json:"a2ui,omitempty"`
}

// AgentMessageResponse acknowledges an accepted agent run.
type AgentMessageResponse struct {
	Accepted bool `json:"accepted"`
}

// AgentACPConfigSelection selects an ACP runtime config option.
type AgentACPConfigSelection struct {
	ConfigID string `json:"configId,omitempty"`
	Source   string `json:"source,omitempty"`
	Value    string `json:"value,omitempty"`
}

// HasAgentMessageWork reports whether an agent message contains useful work.
func HasAgentMessageWork(payload AgentMessageRequest) bool {
	if strings.TrimSpace(payload.Prompt) != "" {
		return true
	}
	if strings.TrimSpace(payload.SelectionText) != "" || strings.TrimSpace(payload.AnchorText) != "" || strings.TrimSpace(payload.CommentID) != "" {
		return true
	}
	if len(payload.References) > 0 {
		return true
	}
	for _, comment := range payload.Comments {
		if !comment.Resolved {
			return true
		}
	}
	return false
}

// AgentDocumentContextsFromWorkspaceDocuments maps workspace documents to agent prompt context documents.
func AgentDocumentContextsFromWorkspaceDocuments(documents []mediamcp.WorkspaceDocument) []AgentDocumentContext {
	result := make([]AgentDocumentContext, 0, len(documents))
	for _, document := range documents {
		result = append(result, AgentDocumentContext{
			ID:        document.ID,
			Title:     document.Title,
			Content:   document.Content,
			Category:  document.Category,
			ParentID:  document.ParentID,
			SortOrder: document.SortOrder,
			Version:   model.NormalizedDocumentVersion(document.Version),
		})
	}
	return result
}

// FilterAgentDocuments returns documents whose IDs appear in ids, preserving document order.
func FilterAgentDocuments(documents []AgentDocumentContext, ids []string) []AgentDocumentContext {
	wanted := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			wanted[id] = true
		}
	}
	result := []AgentDocumentContext{}
	for _, document := range documents {
		if wanted[document.ID] {
			result = append(result, document)
		}
	}
	return result
}
