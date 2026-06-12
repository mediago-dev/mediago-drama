package agent

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/model"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"
)

// DefaultAgentRunTimeout disables the wall-clock timeout for one agent run.
const DefaultAgentRunTimeout time.Duration = 0

// AgentRunner executes one normalized agent request.
type AgentRunner interface {
	Run(context.Context, AgentRunRequest, func(AgentEvent)) (AgentRunResult, error)
}

// AgentPermissionResolver resolves in-flight ACP tool permission requests.
type AgentPermissionResolver interface {
	ResolvePermission(sessionID string, requestID string, optionID string, cancelled bool) error
}

// AgentPendingPermissionProvider lists active ACP permission requests for a session.
type AgentPendingPermissionProvider interface {
	PendingPermissions(sessionID string) []AgentACPPermissionRequest
}

// AgentSessionTitleGenerator produces a short display title for a session.
type AgentSessionTitleGenerator func(context.Context, string) (string, error)

// DocumentStore is the document-facing surface consumed by AgentRuntime.
type DocumentStore interface {
	Dir() string
	ProjectDir(projectID string) (string, error)
	ListWorkspaceDocuments(projectID string) (model.WorkspaceDocumentsResponse, error)
	GetWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error)
	UpdateWorkspaceDocument(projectID string, documentID string, request model.UpdateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, model.WorkspaceDocumentsResponse, error)
	AppendDocumentOperationLog(projectID string, record model.DocumentOperationLogRecord) error
}

// AgentRuntimeConfig configures agent run orchestration.
type AgentRuntimeConfig struct {
	WorkspaceDir          string
	RunTimeout            time.Duration
	BridgeURL             string
	BridgeToken           string
	DocumentMCPConfigPath string
	DocumentEvents        bool
	SessionTitleGenerator AgentSessionTitleGenerator
	SessionTitleTimeout   time.Duration
}

// AgentRuntime coordinates agent sessions, runner calls, and run events.
type AgentRuntime struct {
	workspace DocumentStore
	sessions  *SessionService
	runner    AgentRunner
	publish   func(AgentEvent)
	config    AgentRuntimeConfig
}

// NewAgentRuntime returns an agent runtime service.
func NewAgentRuntime(
	workspace DocumentStore,
	sessions *SessionService,
	runner AgentRunner,
	publish func(AgentEvent),
	config AgentRuntimeConfig,
) *AgentRuntime {
	if config.SessionTitleTimeout <= 0 {
		config.SessionTitleTimeout = 30 * time.Second
	}
	if config.WorkspaceDir == "" && workspace != nil {
		config.WorkspaceDir = workspace.Dir()
	}
	return &AgentRuntime{
		workspace: workspace,
		sessions:  sessions,
		runner:    runner,
		publish:   publish,
		config:    config,
	}
}

// SubmitAgentMessage accepts an agent message and starts a background run.
func (runtime *AgentRuntime) SubmitAgentMessage(payload AgentMessageRequest) (AgentMessageResponse, int, error) {
	if runtime == nil || runtime.workspace == nil || runtime.sessions == nil || runtime.runner == nil {
		return AgentMessageResponse{}, http.StatusServiceUnavailable, fmt.Errorf("agent runtime is unavailable")
	}
	if payload.SessionID == "" {
		return AgentMessageResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 sessionId")
	}
	rawProjectID := payload.ProjectID
	payload.ProjectID = domain.CleanProjectID(payload.ProjectID)
	slog.Debug(
		"agent message payload normalized",
		"session_id", payload.SessionID,
		"raw_project_id", DiagnosticProjectID(rawProjectID),
		"project_id", DiagnosticProjectID(payload.ProjectID),
		"prompt_len", len(payload.Prompt),
		"document_count", len(payload.Documents),
		"reference_count", len(payload.References),
	)
	if !HasAgentMessageWork(payload) {
		return AgentMessageResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 prompt")
	}
	payload.AgentTag = shared.FirstNonEmpty(payload.AgentTag, DefaultAgentName)

	runID := shared.MustRandomID("run")
	runCtx, cancelRun := agentRunContext(runtime.config.RunTimeout)
	acpSessionID, ok := runtime.sessions.StartRun(
		payload.SessionID,
		payload.ProjectID,
		runID,
		cancelRun,
		AgentRunStartOptions{
			AgentTag: payload.AgentTag,
		},
	)
	if !ok {
		cancelRun()
		slog.Warn(
			"agent message rejected because session is unavailable",
			"session_id", payload.SessionID,
			"run_id", runID,
			"project_id", payload.ProjectID,
		)
		return AgentMessageResponse{}, http.StatusConflict, fmt.Errorf("Agent 会话不存在、正在运行或项目不匹配")
	}
	projectDir, err := runtime.projectDirForRun(payload.ProjectID)
	if err != nil {
		cancelRun()
		_ = runtime.sessions.FinishRun(payload.SessionID, runID, "failed", err.Error())
		slog.Warn("agent message rejected because project directory is unavailable", "project_id", payload.ProjectID, "error", err)
		return AgentMessageResponse{}, http.StatusBadRequest, err
	}
	workingDir, err := runtime.workingDirForRun(payload.ProjectID, projectDir)
	if err != nil {
		cancelRun()
		_ = runtime.sessions.FinishRun(payload.SessionID, runID, "failed", err.Error())
		slog.Warn("agent message rejected because working directory is unavailable", "project_id", payload.ProjectID, "error", err)
		return AgentMessageResponse{}, http.StatusBadRequest, err
	}
	documentID := ""
	documentLen := 0
	if payload.Document != nil {
		documentID = payload.Document.ID
		documentLen = len(payload.Document.Content)
	}
	slog.Debug(
		"agent message accepted",
		"session_id", payload.SessionID,
		"run_id", runID,
		"prompt_len", len(payload.Prompt),
		"project_id", payload.ProjectID,
		"document_id", documentID,
		"document_len", documentLen,
		"document_count", len(payload.Documents),
		"project_dir", projectDir,
		"working_dir", workingDir,
		"has_acp_session", acpSessionID != "",
	)

	runtime.publishEvent(AgentEvent{
		ID:        shared.MustRandomID("event"),
		SessionID: payload.SessionID,
		ProjectID: payload.ProjectID,
		RunID:     runID,
		Type:      "agent.message.accepted",
		Message:   "本地 Agent 运行时已接收消息。",
		CreatedAt: timestamp.NowRFC3339Nano(),
	})
	runtime.publishEvent(AgentEvent{
		ID:        shared.MustRandomID("event"),
		SessionID: payload.SessionID,
		ProjectID: payload.ProjectID,
		RunID:     runID,
		Type:      "agent.user.message",
		Message:   payload.Prompt,
		CreatedAt: timestamp.NowRFC3339Nano(),
	})
	runtime.maybeGenerateSessionTitle(payload.SessionID, payload.Prompt)

	go runtime.runAgent(runCtx, cancelRun, payload, runID, acpSessionID, projectDir, workingDir)

	return AgentMessageResponse{Accepted: true}, http.StatusOK, nil
}

func (runtime *AgentRuntime) projectDirForRun(projectID string) (string, error) {
	if strings.TrimSpace(projectID) == "" {
		return shared.ResolveWorkspaceDir(runtime.config.WorkspaceDir), nil
	}
	projectDir, err := runtime.workspace.ProjectDir(projectID)
	if err != nil {
		return "", fmt.Errorf("当前项目目录不可用: %w", err)
	}
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return "", fmt.Errorf("当前项目目录不可用")
	}
	return shared.ResolveWorkspaceDir(projectDir), nil
}

func (runtime *AgentRuntime) workingDirForRun(projectID string, projectDir string) (string, error) {
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return "", fmt.Errorf("当前项目工作目录不可用")
	}
	if strings.TrimSpace(projectID) == "" {
		return shared.ResolveWorkspaceDir(projectDir), nil
	}
	workingDir := filepath.Join(shared.ResolveWorkspaceDir(projectDir), "work")
	if err := os.MkdirAll(workingDir, 0o755); err != nil {
		return "", fmt.Errorf("创建项目工作目录失败: %w", err)
	}
	return workingDir, nil
}

func (runtime *AgentRuntime) maybeGenerateSessionTitle(sessionID string, userPrompt string) {
	if runtime == nil || runtime.config.SessionTitleGenerator == nil || runtime.sessions == nil {
		return
	}
	if strings.TrimSpace(userPrompt) == "" || !runtime.sessions.NeedsTitle(sessionID) {
		return
	}
	go runtime.generateSessionTitle(context.Background(), sessionID, userPrompt)
}

func (runtime *AgentRuntime) generateSessionTitle(ctx context.Context, sessionID string, userPrompt string) {
	ctx, cancel := context.WithTimeout(ctx, runtime.config.SessionTitleTimeout)
	defer cancel()

	completionPrompt := AgentSessionTitlePrompt(userPrompt)
	rawTitle, err := runtime.config.SessionTitleGenerator(ctx, completionPrompt)
	if err != nil {
		slog.Debug("agent session title generation failed", "session_id", sessionID, "error", err)
		return
	}
	title := normalizeAgentSessionTitle(rawTitle)
	if title == "" {
		return
	}
	runtime.sessions.SetTitleIfEmpty(sessionID, title)
}

// ResolvePermission resolves an ACP per-tool permission request.
func (runtime *AgentRuntime) ResolvePermission(payload AgentPermissionDecisionRequest) (AgentSessionStatus, int, error) {
	if runtime == nil || runtime.sessions == nil || runtime.runner == nil {
		return AgentSessionStatus{}, http.StatusServiceUnavailable, fmt.Errorf("agent runtime is unavailable")
	}
	payload.SessionID = strings.TrimSpace(payload.SessionID)
	payload.RequestID = strings.TrimSpace(payload.RequestID)
	payload.OptionID = strings.TrimSpace(payload.OptionID)
	if payload.SessionID == "" {
		return AgentSessionStatus{}, http.StatusBadRequest, fmt.Errorf("缺少 sessionId")
	}
	if payload.RequestID == "" {
		return AgentSessionStatus{}, http.StatusBadRequest, fmt.Errorf("缺少 requestId")
	}
	if !payload.Cancelled && payload.OptionID == "" {
		return AgentSessionStatus{}, http.StatusBadRequest, fmt.Errorf("缺少 optionId")
	}
	resolver, ok := runtime.runner.(AgentPermissionResolver)
	if !ok {
		return AgentSessionStatus{}, http.StatusServiceUnavailable, fmt.Errorf("agent runtime does not support permission decisions")
	}
	if err := resolver.ResolvePermission(payload.SessionID, payload.RequestID, payload.OptionID, payload.Cancelled); err != nil {
		return AgentSessionStatus{}, http.StatusNotFound, err
	}
	return runtime.sessionStatus(payload.SessionID), http.StatusOK, nil
}

// PendingPermissions returns active ACP permission requests for a session.
func (runtime *AgentRuntime) PendingPermissions(sessionID string) []AgentACPPermissionRequest {
	if runtime == nil || runtime.runner == nil {
		return nil
	}
	provider, ok := runtime.runner.(AgentPendingPermissionProvider)
	if !ok {
		return nil
	}
	return provider.PendingPermissions(sessionID)
}

func (runtime *AgentRuntime) sessionStatus(sessionID string) AgentSessionStatus {
	if runtime == nil || runtime.sessions == nil {
		return AgentSessionStatus{SessionID: sessionID}
	}
	status := runtime.sessions.Status(sessionID)
	status.PendingPermissions = runtime.PendingPermissions(sessionID)
	return status
}

func (runtime *AgentRuntime) runAgent(
	ctx context.Context,
	cancel context.CancelFunc,
	payload AgentMessageRequest,
	runID string,
	acpSessionID string,
	projectDir string,
	workingDir string,
) {
	runFinished := false
	finishRun := func(status string, message string) bool {
		if runFinished {
			return true
		}
		result := runtime.sessions.FinishRun(payload.SessionID, runID, status, message)
		runFinished = true
		return result.Terminal
	}
	defer finishRun("finished", "Agent 运行已结束。")

	defer cancel()

	agentTag := shared.FirstNonEmpty(payload.AgentTag, DefaultAgentName)
	runEventBus := NewAgentEventBus(AgentEventContext{
		SessionID: payload.SessionID,
		ProjectID: payload.ProjectID,
		RunID:     runID,
		AgentTag:  agentTag,
	}, runtime.publishEvent)
	publish := runEventBus.PublishEvent
	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		message := fmt.Sprintf("Agent 运行异常：%v", recovered)
		_ = finishRun("failed", message)
		slog.Error("agent run panic", "session_id", payload.SessionID, "run_id", runID, "panic", recovered)
		publish(AgentEvent{
			Type:    "agent.run.failed",
			Message: message,
		})
	}()

	publish(AgentEvent{
		Type:    "agent.run.started",
		Message: "Agent 运行已开始。",
	})
	slog.Info(
		"agent run started",
		"session_id", payload.SessionID,
		"run_id", runID,
		"timeout_ms", runtime.config.RunTimeout.Milliseconds(),
		"has_acp_session", acpSessionID != "",
	)
	result, err := runtime.runner.Run(ctx, AgentRunRequest{
		SessionID:             payload.SessionID,
		RunID:                 runID,
		ACPSessionID:          acpSessionID,
		ProjectID:             payload.ProjectID,
		Prompt:                payload.Prompt,
		AgentTag:              agentTag,
		SystemPrompt:          payload.SystemPrompt,
		AnchorText:            payload.AnchorText,
		CommentID:             payload.CommentID,
		Comments:              payload.Comments,
		Document:              payload.Document,
		Documents:             payload.Documents,
		References:            payload.References,
		SelectionText:         payload.SelectionText,
		WorkspaceDir:          runtime.config.WorkspaceDir,
		ProjectDir:            projectDir,
		WorkingDir:            workingDir,
		BridgeURL:             runtime.config.BridgeURL,
		BridgeToken:           runtime.config.BridgeToken,
		DocumentMCPConfigPath: runtime.config.DocumentMCPConfigPath,
		Model:                 payload.Model,
		Reasoning:             payload.Reasoning,
		Permission:            payload.Permission,
	}, publish)
	if err != nil && ctx.Err() == context.Canceled {
		_ = finishRun("cancelled", "Agent 运行已中断。")
		slog.Info("agent run cancelled", "session_id", payload.SessionID, "run_id", runID)
		publish(AgentEvent{
			Type:    "agent.run.cancelled",
			Message: "Agent 运行已中断。",
		})
		return
	}
	if err != nil {
		runtime.sessions.ClearACPSessionID(payload.SessionID)
		_ = finishRun("failed", err.Error())
		slog.Error("agent run failed", "session_id", payload.SessionID, "run_id", runID, "error", err)
		publish(AgentEvent{
			Type:    "agent.run.failed",
			Message: err.Error(),
		})
		return
	}
	if result.ACPSessionID != "" {
		runtime.sessions.SetACPSessionID(payload.SessionID, runID, result.ACPSessionID)
	}

	if result.DocumentProposal != nil {
		runtime.applyDocumentProposal(result, payload, agentTag, runID, runEventBus)
	}
	if result.A2UI != nil {
		publish(AgentEvent{
			Type:    AgentUIEventType,
			Message: firstNonEmpty(result.Message, "Agent 已生成交互界面。"),
			A2UI:    result.A2UI,
		})
	}
	if result.Message != "" && !result.StreamedMessage {
		publish(AgentEvent{
			Type:    "agent.message.completed",
			Message: result.Message,
			Content: result.Message,
		})
	}
	terminal := finishRun("completed", "Agent 运行已完成。")
	slog.Info("agent run completed", "session_id", payload.SessionID, "run_id", runID)
	if terminal {
		publish(AgentEvent{
			Type:         "agent.run.completed",
			Message:      "Agent 运行已完成。",
			ACPSessionID: result.ACPSessionID,
		})
	}
}

func (runtime *AgentRuntime) applyDocumentProposal(
	result AgentRunResult,
	payload AgentMessageRequest,
	agentTag string,
	runID string,
	runEventBus *AgentEventBus,
) {
	var documents []mediamcp.WorkspaceDocument
	if payload.ProjectID != "" && result.DocumentProposal.DocumentID != "" {
		before, beforeOK, beforeErr := runtime.workspace.GetWorkspaceDocument(payload.ProjectID, result.DocumentProposal.DocumentID)
		if beforeErr != nil {
			slog.Warn("agent document proposal pre-read failed", "session_id", payload.SessionID, "run_id", runID, "project_id", payload.ProjectID, "document_id", result.DocumentProposal.DocumentID, "error", beforeErr)
		}
		update := model.UpdateWorkspaceDocumentRequest{}
		if result.DocumentProposal.Title != "" {
			update.Title = &result.DocumentProposal.Title
		}
		if result.DocumentProposal.Content != "" {
			update.Content = &result.DocumentProposal.Content
		}
		clean := false
		update.IsDirty = &clean
		_, state, err := runtime.workspace.UpdateWorkspaceDocument(payload.ProjectID, result.DocumentProposal.DocumentID, update)
		if err != nil {
			slog.Warn("agent document proposal backend apply failed", "session_id", payload.SessionID, "run_id", runID, "project_id", payload.ProjectID, "document_id", result.DocumentProposal.DocumentID, "error", err)
		} else {
			documents = state.Documents
			if beforeOK {
				for _, document := range state.Documents {
					if document.ID == result.DocumentProposal.DocumentID {
						runtime.publishDocumentEditLifecycle(
							runEventBus,
							payload.ProjectID,
							SnapshotDocument(before),
							document,
							"replace",
							document.Content,
							shared.FirstNonEmpty(result.DocumentProposal.Summary, "已应用文档更新方案。"),
							payload.AnchorText,
							AgentEventContext{
								RunID:    runID,
								AgentTag: agentTag,
							},
						)
						break
					}
				}
			}
		}
	}
	runEventBus.PublishEvent(AgentEvent{
		Type:             "agent.patch.proposed",
		Message:          "已生成文档更新方案。",
		DocumentProposal: result.DocumentProposal,
		Documents:        documents,
	})
}

// PublishAgentRunCompleted publishes a terminal run completion event.
func (runtime *AgentRuntime) PublishAgentRunCompleted(sessionID string, projectID string, runID string, message string, acpSessionID string) {
	if strings.TrimSpace(message) == "" {
		message = "Agent 运行已完成。"
	}
	runtime.publishEvent(AgentEvent{
		ID:           shared.MustRandomID("event"),
		SessionID:    sessionID,
		ProjectID:    projectID,
		Type:         "agent.run.completed",
		RunID:        runID,
		Message:      message,
		ACPSessionID: acpSessionID,
		CreatedAt:    timestamp.NowRFC3339Nano(),
	})
}

func (runtime *AgentRuntime) publishDocumentEditLifecycle(
	bus *AgentEventBus,
	projectID string,
	before AgentDocumentEditSnapshot,
	after mediamcp.WorkspaceDocument,
	mode string,
	delta string,
	summary string,
	anchorText string,
	context AgentEventContext,
) {
	if bus == nil {
		return
	}
	if summary == "" {
		summary = "已写入《" + after.Title + "》。"
	}
	runtime.publishDocumentEdit(bus, projectID, "agent.document.edit.started", after, AgentDocumentEditDelta{
		Summary: "开始写入《" + after.Title + "》。",
		Status:  "streaming",
	}, context)
	if delta != "" || mode == "replace" {
		runtime.publishDocumentEdit(bus, projectID, "agent.document.edit.delta", after, AgentDocumentEditDelta{
			Mode:       shared.FirstNonEmpty(mode, "replace"),
			Delta:      delta,
			Content:    after.Content,
			AnchorText: anchorText,
			Status:     "streaming",
		}, context)
	}
	if before.ID != "" || after.ID != "" {
		runtime.recordDocumentEditOperation(bus, projectID, before, SnapshotDocument(after), summary, context)
	}
	runtime.publishDocumentEdit(bus, projectID, "agent.document.edit.checkpoint", after, AgentDocumentEditDelta{
		Content: after.Content,
		Summary: summary,
		Status:  "checkpoint",
	}, context)
	runtime.publishDocumentEdit(bus, projectID, "agent.document.edit.completed", after, AgentDocumentEditDelta{
		Content: after.Content,
		Summary: "流式编辑已完成。",
		Status:  "completed",
	}, context)
}

func (runtime *AgentRuntime) publishDocumentEdit(bus *AgentEventBus, projectID string, eventType string, document mediamcp.WorkspaceDocument, delta AgentDocumentEditDelta, context AgentEventContext) {
	bus.PublishEvent(BuildDocumentEditEvent(eventType, document, delta, DocumentEditEventContext{
		ProjectID: projectID,
		RunID:     context.RunID,
		AgentTag:  context.AgentTag,
	}))
}

func (runtime *AgentRuntime) recordDocumentEditOperation(bus *AgentEventBus, projectID string, before AgentDocumentEditSnapshot, after AgentDocumentEditSnapshot, summary string, context AgentEventContext) {
	if runtime.workspace == nil {
		return
	}
	record, ok := NewDocumentEditOperationLogRecord(before, after, summary, context.AgentTag)
	if !ok {
		return
	}
	if err := runtime.workspace.AppendDocumentOperationLog(projectID, record); err != nil {
		slog.Warn(
			"recording document edit operation log failed",
			"project_id", projectID,
			"document_id", after.ID,
			"error", err,
		)
		bus.PublishEvent(BuildDocumentEditFailedEvent(projectID, after.ID, after.Title, "写入流式编辑操作日志失败："+err.Error()))
	}
}

func (runtime *AgentRuntime) publishEvent(event AgentEvent) {
	if runtime == nil || runtime.publish == nil {
		return
	}
	runtime.publish(event)
}

func agentRunContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(context.Background())
	}
	return context.WithTimeout(context.Background(), timeout)
}
