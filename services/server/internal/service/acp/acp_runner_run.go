package acp

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

// Run executes one ACP agent prompt.
func (runner *acpAgentRunner) Run(ctx context.Context, request agentRunRequest, publish func(agentEvent)) (agentRunResult, error) {
	return runner.runOnce(ctx, request, publish)
}

func (runner *acpAgentRunner) runOnce(ctx context.Context, request agentRunRequest, publish func(agentEvent)) (agentRunResult, error) {
	publish = scopedACPEventPublisher(request.RunID, publish)
	runStartedAt := time.Now()
	command, args := runner.activeCommandArgv()
	workspaceDir := runner.absoluteWorkspaceDir()
	runDir := runner.absoluteRunDir(request)
	if runDir != "." {
		if err := os.MkdirAll(runDir, 0o755); err != nil {
			return agentRunResult{}, fmt.Errorf("creating ACP run directory: %w", err)
		}
	}
	if strings.TrimSpace(request.WorkspaceDir) == "" {
		request.WorkspaceDir = workspaceDir
	}
	if strings.TrimSpace(request.WorkingDir) == "" {
		request.WorkingDir = runDir
	}
	if strings.TrimSpace(request.ProjectDir) == "" {
		request.ProjectDir = runDir
	}
	if strings.TrimSpace(request.DocumentMCPConfigPath) == "" {
		request.DocumentMCPConfigPath = runner.documentMCPConfigPath
	}
	logArgs := []any{
		"session_id", request.SessionID,
		"run_id", request.RunID,
		"command", command,
		"arg_count", len(args),
		"workspace", workspaceDir,
		"cwd", runDir,
	}
	acpLog().Info("acp run starting", logArgs...)
	rawLog := newACPRawLogger(workspaceDir, request.ProjectDir, request.ProjectID, request.SessionID, request.RunID)
	client := &acpClient{
		publish:      publish,
		workspaceDir: workspaceDir,
		sessionID:    request.SessionID,
		runID:        request.RunID,
		rawLog:       rawLog,
	}

	fixedInstructions := runner.fixedInstructions(request)
	processConfig, err := runner.prepareProcessConfig(ctx, command, args, request, fixedInstructions)
	if err != nil {
		return agentRunResult{}, err
	}
	instructionDelivery := "inline"
	if processConfig.NativeInstructionsInjected {
		instructionDelivery = "native"
	}
	currentInstructionHash := instructionFingerprint(
		acpBackendIdentity(command, args),
		instructionDelivery,
		fixedInstructions,
	)
	processSpec := acpResidentProcessSpec{
		command:         command,
		args:            append([]string(nil), args...),
		dir:             runDir,
		workspaceDir:    workspaceDir,
		env:             mergedProcessEnv(processConfig),
		configDir:       processConfig.ConfigDir,
		instructionHash: currentInstructionHash,
		logArgs:         append([]any(nil), logArgs...),
	}
	processSpec.fingerprint = residentACPProcessFingerprint(processSpec)

	lease, err := runner.acquireResidentLease(request.SessionID)
	if err != nil {
		return agentRunResult{}, err
	}
	residentEnabled := supportsResidentACP(command, args)
	retainProcess := false
	var process *acpResidentProcess
	var router *acpClientRouter
	defer func() {
		client.cancelPendingPermissions()
		runner.activeClients.Delete(request.SessionID)
		if router != nil {
			router.unbind(client)
		}
		if !retainProcess || !residentEnabled {
			lease.invalidate(process)
		}
		lease.release()
	}()

	process = lease.process()
	if process != nil && process.fingerprint != processSpec.fingerprint {
		acpLog().Info("acp resident process config changed; restarting", logArgs...)
		lease.invalidate(process)
		process = nil
	}
	if process == nil {
		router = &acpClientRouter{}
		if err := router.bind(client); err != nil {
			return agentRunResult{}, err
		}
		runner.activeClients.Store(request.SessionID, client)
		process, err = runner.startResidentProcess(ctx, processSpec, router)
		if err != nil {
			return agentRunResult{}, err
		}
		if err := lease.setProcess(process); err != nil {
			return agentRunResult{}, err
		}
		if err := runner.initializeResidentProcess(ctx, process, processSpec); err != nil {
			lease.invalidate(process)
			return agentRunResult{}, err
		}
	} else {
		router = process.router
		if router == nil {
			return agentRunResult{}, fmt.Errorf("reusing ACP resident process: missing client router")
		}
		if err := router.bind(client); err != nil {
			return agentRunResult{}, err
		}
		runner.activeClients.Store(request.SessionID, client)
		acpLog().Info("acp resident process reused", logArgs...)
	}
	conn := process.connection
	initializeResponse := process.initializeResponse
	invalidateCancelledProcess := func() {
		lease.invalidate(process)
	}

	mcpResolution := resolveDocumentMCPServersForRun(workspaceDir, request)
	mcpServers := mcpResolution.Servers
	if mcpServers == nil {
		mcpServers = []acp.McpServer{}
	}
	acpLog().Debug(
		"acp document mcp servers resolved",
		append(logArgs,
			"project_id", mcpResolution.ProjectID,
			"mcp_server_count", len(mcpServers),
			"mcp_server_name", mediaGoDramaMCPServerName,
			"mcp_transport", mcpResolution.Transport,
			"mcp_url", mcpResolution.URL,
			"mcp_command", mcpResolution.Executable,
			"mcp_args", strings.Join(mcpResolution.Args, " "),
			"disabled_reason", mcpResolution.DisabledReason,
			"disabled_detail", mcpResolution.DisabledDetail,
		)...,
	)
	if len(mcpServers) == 0 {
		message := documentMCPDisabledActivityMessage(mcpResolution)
		publish(agentEvent{
			Type:    "agent.acp",
			Message: message,
			ACP: &agentACPEvent{
				Kind: "mcpUnavailable",
				RuntimeAlert: &AgentACPRuntimeAlert{
					Severity: "warning",
					Title:    "文档 MCP 未挂载",
					Message:  message,
					Reason:   mcpResolution.DisabledReason,
					Detail:   mcpResolution.DisabledDetail,
				},
			},
		})
	}
	sessionID := acp.SessionId(strings.TrimSpace(request.ACPSessionID))
	hadPriorACPSession := sessionID != ""
	reusedACPSession := false
	if sessionID != "" && !instructionHashMatches(request.ACPInstructionHash, currentInstructionHash) {
		acpLog().Info(
			"acp session instruction fingerprint changed; creating new session",
			append(logArgs, "acp_session_id", sessionID)...,
		)
		publish(agentEvent{
			Type:    "agent.activity",
			Message: "Agent 指令已更新，正在迁移到新会话。",
		})
		sessionID = ""
	}
	if sessionID != "" {
		if initializeResponse.AgentCapabilities.SessionCapabilities.Resume != nil {
			acpLog().Debug("acp session resume starting", append(logArgs, "acp_session_id", sessionID)...)
			resumeStartedAt := time.Now()
			if _, err := conn.ResumeSession(ctx, acp.ResumeSessionRequest{
				SessionId:  sessionID,
				Cwd:        runDir,
				McpServers: mcpServers,
			}); err != nil {
				acpLog().Warn("acp session resume failed", append(logArgs, "acp_session_id", sessionID, "error", err)...)
				publish(agentEvent{
					Type:    "agent.activity",
					Message: "ACP 恢复失败，正在创建新会话。",
				})
				sessionID = ""
			} else {
				reusedACPSession = true
				acpLog().Info("acp session resumed", append(logArgs, "acp_session_id", sessionID, "duration_ms", time.Since(resumeStartedAt).Milliseconds())...)
			}
		} else if initializeResponse.AgentCapabilities.LoadSession {
			acpLog().Debug("acp session load starting", append(logArgs, "acp_session_id", sessionID)...)
			loadStartedAt := time.Now()
			if _, err := conn.LoadSession(ctx, acp.LoadSessionRequest{
				SessionId:  sessionID,
				Cwd:        runDir,
				McpServers: mcpServers,
			}); err != nil {
				acpLog().Warn("acp session load failed", append(logArgs, "acp_session_id", sessionID, "error", err)...)
				publish(agentEvent{
					Type:    "agent.activity",
					Message: "ACP 旧会话载入失败，正在创建新会话。",
				})
				sessionID = ""
			} else {
				reusedACPSession = true
				acpLog().Info("acp session loaded", append(logArgs, "acp_session_id", sessionID, "duration_ms", time.Since(loadStartedAt).Milliseconds())...)
			}
		} else {
			acpLog().Debug("acp session reuse unsupported; creating new session", append(logArgs, "acp_session_id", sessionID)...)
			sessionID = ""
		}
	}
	if sessionID == "" {
		acpLog().Debug("acp session create starting", logArgs...)
		createStartedAt := time.Now()
		session, err := conn.NewSession(ctx, acp.NewSessionRequest{
			Cwd:        runDir,
			McpServers: mcpServers,
		})
		if err != nil {
			acpLog().Error("acp session create failed", append(logArgs, "error", err)...)
			return agentRunResult{}, fmt.Errorf("creating ACP session: %w", err)
		}
		sessionID = session.SessionId
		acpLog().Info("acp session created", append(logArgs, "acp_session_id", sessionID, "duration_ms", time.Since(createStartedAt).Milliseconds())...)
	}
	client.acpSessionID = string(sessionID)
	client.rawLog.setACPSessionID(string(sessionID))
	if err := applyACPSessionSelections(ctx, conn, sessionID, request, logArgs); err != nil {
		acpLog().Error("acp session config selection failed", append(logArgs, "acp_session_id", sessionID, "error", err)...)
		return agentRunResult{}, err
	}

	prompt := runner.buildPromptForRequest(request, fixedInstructions, processConfig.NativeInstructionsInjected)
	recapInjected := false
	// A continuation whose previous ACP session could not be reused starts
	// from a blank session: replay a compact transcript recap so decisions the
	// user already made (target resource, style, params) survive the rebuild.
	if hadPriorACPSession && !reusedACPSession {
		if recap := runner.sessionRecapFor(ctx, request); recap != "" {
			prompt = recap + "\n\n" + prompt
			recapInjected = true
			acpLog().Info("acp session recap injected", append(logArgs, "acp_session_id", sessionID, "recap_len", len(recap))...)
			publish(agentEvent{
				Type:    "agent.activity",
				Message: "已向新会话回放此前对话，之前的确认继续有效。",
			})
		}
	}
	acpLog().Debug(
		"acp.prompt.assembled",
		append(logArgs,
			"acp_session_id", sessionID,
			"bytes", len(prompt),
			"fixed_instruction_bytes", len(fixedInstructions),
			"instruction_delivery", instructionDelivery,
		)...,
	)
	acpLog().Info(
		"acp prompt starting",
		append(logArgs,
			"acp_session_id", sessionID,
			"prompt_len", len(prompt),
			"user_prompt_len", len(request.Prompt),
			"fixed_instruction_len", len(fixedInstructions),
			"instruction_delivery", instructionDelivery,
			"has_document", request.Document != nil,
			"document_count", len(request.Documents),
		)...,
	)
	promptRequest := acp.PromptRequest{
		SessionId: sessionID,
		Prompt:    []acp.ContentBlock{acp.TextBlock(prompt)},
	}
	promptStartedAt := time.Now()
	promptResponse, err := promptACPSession(ctx, conn, client, promptRequest, invalidateCancelledProcess)
	if err != nil && reusedACPSession && isACPResourceNotFoundError(err) {
		acpLog().Warn("acp prompt failed for resumed session; retrying new session", append(logArgs, "acp_session_id", sessionID, "error", err)...)
		publish(agentEvent{
			Type:    "agent.activity",
			Message: "ACP 旧会话已失效，正在创建新会话重试。",
		})
		client.resetMessage()
		session, createErr := conn.NewSession(ctx, acp.NewSessionRequest{
			Cwd:        runDir,
			McpServers: mcpServers,
		})
		if createErr != nil {
			acpLog().Error("acp retry session create failed", append(logArgs, "error", createErr)...)
			return agentRunResult{}, fmt.Errorf("creating ACP retry session: %w", createErr)
		}
		sessionID = session.SessionId
		client.acpSessionID = string(sessionID)
		client.rawLog.setACPSessionID(string(sessionID))
		promptRequest.SessionId = sessionID
		if err := applyACPSessionSelections(ctx, conn, sessionID, request, logArgs); err != nil {
			acpLog().Error("acp retry session config selection failed", append(logArgs, "acp_session_id", sessionID, "error", err)...)
			return agentRunResult{}, err
		}
		if !recapInjected {
			if recap := runner.sessionRecapFor(ctx, request); recap != "" {
				prompt = recap + "\n\n" + prompt
				promptRequest.Prompt = []acp.ContentBlock{acp.TextBlock(prompt)}
				recapInjected = true
				acpLog().Info("acp session recap injected on retry", append(logArgs, "acp_session_id", sessionID, "recap_len", len(recap))...)
			}
		}
		acpLog().Info("acp retry prompt starting", append(logArgs, "acp_session_id", sessionID)...)
		promptStartedAt = time.Now()
		promptResponse, err = promptACPSession(ctx, conn, client, promptRequest, invalidateCancelledProcess)
	}
	if err == nil && shouldRetryEmptyACPPrompt(promptResponse, client.messageText(), client.runtimeErrorText(), client.hasPromptActivity()) {
		acpLog().Warn(
			"acp prompt returned empty response; retrying new session",
			append(logArgs,
				"acp_session_id", sessionID,
				"reused_acp_session", reusedACPSession,
				"stop_reason", promptResponse.StopReason,
				"usage_input_tokens", promptResponse.Usage.InputTokens,
				"usage_output_tokens", promptResponse.Usage.OutputTokens,
				"usage_total_tokens", promptResponse.Usage.TotalTokens,
			)...,
		)
		publish(agentEvent{
			Type:    "agent.activity",
			Message: "ACP 没有返回内容，正在创建新会话重试。",
		})
		client.resetMessage()
		session, createErr := conn.NewSession(ctx, acp.NewSessionRequest{
			Cwd:        runDir,
			McpServers: mcpServers,
		})
		if createErr != nil {
			acpLog().Error("acp empty-response retry session create failed", append(logArgs, "error", createErr)...)
			return agentRunResult{}, fmt.Errorf("creating ACP empty-response retry session: %w", createErr)
		}
		sessionID = session.SessionId
		client.acpSessionID = string(sessionID)
		client.rawLog.setACPSessionID(string(sessionID))
		promptRequest.SessionId = sessionID
		if err := applyACPSessionSelections(ctx, conn, sessionID, request, logArgs); err != nil {
			acpLog().Error("acp empty-response retry session config selection failed", append(logArgs, "acp_session_id", sessionID, "error", err)...)
			return agentRunResult{}, err
		}
		// This retry also lands on a brand-new blank session — inject the
		// recap here too, or the rebuilt session loses every prior
		// confirmation exactly like the paths above.
		if !recapInjected {
			if recap := runner.sessionRecapFor(ctx, request); recap != "" {
				prompt = recap + "\n\n" + prompt
				promptRequest.Prompt = []acp.ContentBlock{acp.TextBlock(prompt)}
				recapInjected = true
				acpLog().Info("acp session recap injected on empty-response retry", append(logArgs, "acp_session_id", sessionID, "recap_len", len(recap))...)
			}
		}
		acpLog().Info("acp empty-response retry prompt starting", append(logArgs, "acp_session_id", sessionID)...)
		promptStartedAt = time.Now()
		promptResponse, err = promptACPSession(ctx, conn, client, promptRequest, invalidateCancelledProcess)
	}
	if err != nil {
		acpLog().Error("acp prompt failed", append(logArgs, "acp_session_id", sessionID, "duration_ms", time.Since(promptStartedAt).Milliseconds(), "error", err)...)
		if alert := runtimeAlertForACPPromptError(err, ctx.Err()); alert != nil {
			publish(acpRuntimeAlertEvent(alert))
		}
		return agentRunResult{}, friendlyACPError("running ACP prompt", err)
	}
	acpLog().Info(
		"acp prompt completed",
		append(append(logArgs,
			"acp_session_id", sessionID,
			"stop_reason", promptResponse.StopReason,
			"duration_ms", time.Since(promptStartedAt).Milliseconds(),
		), client.promptMetrics()...)...,
	)
	if promptResponse.StopReason != "" && promptResponse.StopReason != acp.StopReasonEndTurn {
		publish(agentEvent{
			Type:    "agent.activity",
			Message: "ACP 停止原因：" + TranslateACPStatus(string(promptResponse.StopReason)),
		})
	}
	requestedFinalMessage := false
	hadActivityBeforeFinalMessage := false
	if shouldRequestACPFinalMessage(promptResponse, client.messageItemText(), client.runtimeErrorText(), client.hasPromptActivity()) {
		requestedFinalMessage = true
		hadActivityBeforeFinalMessage = true
		publish(agentEvent{
			Type:    "agent.activity",
			Message: "ACP 没有返回最终消息，正在请求收尾回复。",
		})
		acpLog().Warn(
			"acp prompt completed without final message; requesting final response",
			append(append(logArgs,
				"acp_session_id", sessionID,
				"stop_reason", promptResponse.StopReason,
			), client.promptMetrics()...)...,
		)
		finalPromptStartedAt := time.Now()
		finalPromptResponse, finalPromptErr := promptACPSession(ctx, conn, client, acp.PromptRequest{
			SessionId: sessionID,
			Prompt:    []acp.ContentBlock{acp.TextBlock(buildACPFinalMessagePrompt())},
		}, invalidateCancelledProcess)
		if finalPromptErr != nil {
			acpLog().Error(
				"acp final-message prompt failed",
				append(logArgs,
					"acp_session_id", sessionID,
					"duration_ms", time.Since(finalPromptStartedAt).Milliseconds(),
					"error", finalPromptErr,
				)...,
			)
			if alert := runtimeAlertForACPPromptError(finalPromptErr, ctx.Err()); alert != nil {
				publish(acpRuntimeAlertEvent(alert))
			}
			return agentRunResult{}, friendlyACPError("running ACP final-message prompt", finalPromptErr)
		}
		promptResponse = finalPromptResponse
		acpLog().Info(
			"acp final-message prompt completed",
			append(append(logArgs,
				"acp_session_id", sessionID,
				"stop_reason", promptResponse.StopReason,
				"duration_ms", time.Since(finalPromptStartedAt).Milliseconds(),
			), client.promptMetrics()...)...,
		)
		if promptResponse.StopReason != "" && promptResponse.StopReason != acp.StopReasonEndTurn {
			publish(agentEvent{
				Type:    "agent.activity",
				Message: "ACP 收尾停止原因：" + TranslateACPStatus(string(promptResponse.StopReason)),
			})
		}
	}

	rawFinalMessage := client.messageText()
	rawFinalItem := client.messageItemText()
	final := parseACPFinalResponseForItem(rawFinalMessage, rawFinalItem, request)
	if strings.TrimSpace(rawFinalItem) == "" {
		if runtimeError := client.runtimeErrorText(); runtimeError != "" {
			final.Message = runtimeError
		} else if fallback := fallbackACPFinalMessage(request, requestedFinalMessage || hadActivityBeforeFinalMessage); fallback != "" {
			final.Message = fallback
		}
	}
	if final.Message == "" {
		final.Message = "ACP Agent 已完成。"
	}
	acpLog().Debug(
		"acp final response parsed",
		append(logArgs,
			"acp_session_id", sessionID,
			"message_len", len(final.Message),
			"has_document_proposal", final.ProposedDocument != nil,
			"has_a2ui", final.A2UI != nil,
		)...,
	)
	acpLog().Info(
		"acp run completed",
		append(append(logArgs,
			"acp_session_id", sessionID,
			"stop_reason", promptResponse.StopReason,
			"duration_ms", time.Since(runStartedAt).Milliseconds(),
			"message_len", len(final.Message),
			"has_document_proposal", final.ProposedDocument != nil,
		), client.promptMetrics()...)...,
	)

	retainProcess = true
	return agentRunResult{
		ACPSessionID:       string(sessionID),
		ACPInstructionHash: currentInstructionHash,
		Message:            final.Message,
		MessageItemID:      client.messageItemID(),
		StreamedMessage:    client.hasStreamedMessage(),
		DocumentProposal:   final.ProposedDocument,
		A2UI:               final.A2UI,
	}, nil
}

func promptACPSession(
	ctx context.Context,
	conn acpPromptConnection,
	client *acpClient,
	request acp.PromptRequest,
	onCancellationTimeout func(),
) (acp.PromptResponse, error) {
	client.resetMessage()
	client.beginPromptMetrics()
	client.setAcceptingSessionUpdates(true)
	promptDone := make(chan struct{})
	if onCancellationTimeout != nil && ctx.Done() != nil {
		go func() {
			select {
			case <-ctx.Done():
				timer := time.NewTimer(residentACPCancelGracePeriod)
				defer timer.Stop()
				select {
				case <-timer.C:
					onCancellationTimeout()
				case <-promptDone:
				}
			case <-promptDone:
			}
		}()
	}
	response, err := conn.Prompt(ctx, request)
	close(promptDone)
	client.setAcceptingSessionUpdates(false)
	client.finishThoughts()
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	return response, err
}

func (runner *acpAgentRunner) buildPromptForRequest(
	request agentRunRequest,
	fixedInstructions string,
	nativeInstructionsInjected bool,
) string {
	userPrompt := strings.TrimSpace(BuildACPUserPrompt(request))
	if nativeInstructionsInjected {
		return userPrompt
	}
	systemPrompt := strings.TrimSpace(fixedInstructions)
	if systemPrompt == "" {
		return userPrompt
	}
	if userPrompt == "" {
		return systemPrompt
	}
	return strings.Join([]string{systemPrompt, "# 用户请求", userPrompt}, "\n\n")
}

func friendlyACPError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if friendly := friendlyACPProviderErrorMessage(err.Error()); friendly != "" {
		return fmt.Errorf("%s: %s", operation, friendly)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func shouldRetryEmptyACPPrompt(response acp.PromptResponse, rawFinalMessage string, runtimeErrorMessage string, promptHadActivity bool) bool {
	if promptHadActivity {
		return false
	}
	if strings.TrimSpace(rawFinalMessage) != "" || strings.TrimSpace(runtimeErrorMessage) != "" {
		return false
	}
	if response.Usage == nil {
		return false
	}
	if response.StopReason != "" && response.StopReason != acp.StopReasonEndTurn {
		return false
	}
	return response.Usage.InputTokens == 0 &&
		response.Usage.OutputTokens == 0 &&
		response.Usage.TotalTokens == 0
}

func buildACPFinalMessagePrompt() string {
	return strings.Join([]string{
		"上一轮已经结束，但没有通过 ACP agent_message_chunk 发送最终回复。",
		"请现在只输出面向用户的最终回复：不要调用工具，不要继续探索，不要返回 JSON。",
		"如果已经完成修改，请简要说明完成内容；如果没有修改任何内容，请直接回答用户最后的问题。",
		"使用用户最后一条消息的语言。",
	}, "\n")
}

func shouldRequestACPFinalMessage(response acp.PromptResponse, rawFinalMessage string, runtimeErrorMessage string, promptHadActivity bool) bool {
	if strings.TrimSpace(rawFinalMessage) != "" || strings.TrimSpace(runtimeErrorMessage) != "" {
		return false
	}
	if !promptHadActivity {
		return false
	}
	if response.StopReason != "" && response.StopReason != acp.StopReasonEndTurn {
		return false
	}
	return true
}

func fallbackACPFinalMessage(request agentRunRequest, promptHadActivity bool) string {
	if promptHadActivity {
		return "模型产生了思考或工具调用事件，但 ACP 运行时没有发送可展示的最终回复；这次不能确认调用成功。请重试，或切换模型后再试。"
	}
	return "模型调用没有返回可展示内容；这次不能确认调用成功。请重试，或切换模型后再试。"
}

func isACPResourceNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "resource not found")
}
