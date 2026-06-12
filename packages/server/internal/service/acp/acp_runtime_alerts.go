package acp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	acpPromptStallWarningDelay = 60 * time.Second
	acpPromptIdleTimeout       = 2 * time.Minute
	acpPromptIdleRetryLimit    = 1
	acpPromptMonitorTick       = 5 * time.Second
	acpPromptMonitorMinTick    = 10 * time.Millisecond
)

type acpPromptProgressMonitorOptions struct {
	StallWarningDelay time.Duration
	IdleTimeout       time.Duration
	OnIdle            func(acpPromptIdleSnapshot)
}

type acpPromptIdleSnapshot struct {
	Elapsed           time.Duration
	Timeout           time.Duration
	UpdateCount       int
	ToolCallCount     int
	MutatingToolCalls int
	Retryable         bool
}

type acpPromptIdleError struct {
	acpPromptIdleSnapshot
}

func (err *acpPromptIdleError) Error() string {
	if err == nil {
		return "ACP prompt idle timeout"
	}
	return fmt.Sprintf(
		"ACP prompt idle timeout after %s without session updates (timeout %s, retryable=%t, updates=%d, tool_calls=%d, mutating_tool_calls=%d)",
		formatRuntimeAlertDuration(err.Elapsed),
		formatRuntimeAlertDuration(err.Timeout),
		err.Retryable,
		err.UpdateCount,
		err.ToolCallCount,
		err.MutatingToolCalls,
	)
}

func (client *acpClient) startPromptProgressMonitor(ctx context.Context, threshold time.Duration) func() {
	return client.startPromptProgressMonitorWithOptions(ctx, acpPromptProgressMonitorOptions{
		StallWarningDelay: threshold,
	})
}

func (client *acpClient) startPromptProgressMonitorWithOptions(ctx context.Context, options acpPromptProgressMonitorOptions) func() {
	if client == nil || (options.StallWarningDelay <= 0 && options.IdleTimeout <= 0) {
		return func() {}
	}
	monitorCtx, cancel := context.WithCancel(ctx)
	go func() {
		ticker := time.NewTicker(acpPromptProgressTickInterval(options))
		defer ticker.Stop()
		for {
			select {
			case <-monitorCtx.Done():
				return
			case <-ticker.C:
				if options.StallWarningDelay > 0 {
					if elapsed, stalled := client.markPromptStalled(options.StallWarningDelay); stalled {
						if client.publish != nil {
							client.publish(acpRuntimeAlertEvent(acpPromptStallAlert(elapsed)))
						}
					}
				}
				if options.IdleTimeout <= 0 || options.OnIdle == nil {
					continue
				}
				if snapshot, idle := client.promptIdleSnapshot(options.IdleTimeout); idle {
					options.OnIdle(snapshot)
					return
				}
			}
		}
	}()
	return cancel
}

func acpPromptProgressTickInterval(options acpPromptProgressMonitorOptions) time.Duration {
	interval := acpPromptMonitorTick
	if options.StallWarningDelay > 0 && options.StallWarningDelay < interval {
		interval = options.StallWarningDelay / 5
	}
	if options.IdleTimeout > 0 && options.IdleTimeout < interval {
		interval = options.IdleTimeout / 5
	}
	if interval < acpPromptMonitorMinTick {
		return acpPromptMonitorMinTick
	}
	return interval
}

func acpRuntimeAlertEvent(alert *AgentACPRuntimeAlert) agentEvent {
	if alert == nil {
		return agentEvent{}
	}
	return agentEvent{
		Type:    "agent.acp",
		Message: alert.Message,
		ACP: &agentACPEvent{
			Kind:         "runtimeError",
			RuntimeAlert: alert,
		},
	}
}

func acpPromptStallAlert(elapsed time.Duration) *AgentACPRuntimeAlert {
	return &AgentACPRuntimeAlert{
		Severity: "warning",
		Title:    "模型暂时没有返回新内容",
		Message:  "ACP 已有一段时间没有收到新的模型消息或工具调用。界面仍在等待后端事件；编辑确认只有在模型真正发起编辑工具调用后才会出现。",
		Reason:   "acp_no_session_updates",
		Detail:   "no session update for " + formatRuntimeAlertDuration(elapsed),
	}
}

func acpPromptIdleRetryAlert(idleErr *acpPromptIdleError, attempt int, maxRetries int) *AgentACPRuntimeAlert {
	elapsed := time.Duration(0)
	if idleErr != nil {
		elapsed = idleErr.Elapsed
	}
	return &AgentACPRuntimeAlert{
		Severity: "warning",
		Title:    "模型流中断，正在自动重试",
		Message:  fmt.Sprintf("ACP 已 %s 没有收到新的模型消息或工具调用，正在重启 opencode 并重试本轮请求（第 %d/%d 次）。", formatRuntimeAlertDuration(elapsed), attempt, maxRetries),
		Reason:   "acp_prompt_idle_retrying",
		Detail:   acpPromptIdleDetail(idleErr),
	}
}

func runtimeAlertForACPStderr(message string) *AgentACPRuntimeAlert {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return nil
	}
	if strings.Contains(normalized, "idle timeout waiting for sse") ||
		strings.Contains(normalized, "responsestreamdisconnected") ||
		strings.Contains(normalized, "reconnecting...") {
		return &AgentACPRuntimeAlert{
			Severity: "warning",
			Title:    "模型流断开，正在重连",
			Message:  "上游模型流长时间没有继续返回内容，ACP 正在尝试重连。编辑确认只有在模型真正发起编辑工具调用后才会出现。",
			Reason:   "upstream_stream_idle_timeout",
			Detail:   compactRuntimeAlertDetail(message),
		}
	}
	return nil
}

func runtimeAlertForACPPromptError(err error, contextErr error) *AgentACPRuntimeAlert {
	if err == nil && contextErr == nil {
		return nil
	}
	var idleErr *acpPromptIdleError
	if errors.As(err, &idleErr) {
		if idleErr.Retryable {
			return &AgentACPRuntimeAlert{
				Severity: "warning",
				Title:    "模型流中断",
				Message:  "ACP 长时间没有收到新的模型消息或工具调用，已停止本轮等待。可以重新发送，或等待自动重试策略接管。",
				Reason:   "acp_prompt_idle_timeout",
				Detail:   acpPromptIdleDetail(idleErr),
			}
		}
		return &AgentACPRuntimeAlert{
			Severity: "warning",
			Title:    "模型流中断，未自动重试",
			Message:  "ACP 长时间没有收到新的模型消息或工具调用；由于本轮已经出现可能修改内容的工具调用，为避免重复写入，系统没有自动重试。",
			Reason:   "acp_prompt_idle_after_mutation",
			Detail:   acpPromptIdleDetail(idleErr),
		}
	}
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	contextText := ""
	if contextErr != nil {
		contextText = contextErr.Error()
	}
	normalized := strings.ToLower(strings.TrimSpace(errText + " " + contextText))
	switch {
	case contextErr == context.DeadlineExceeded || strings.Contains(normalized, "context deadline exceeded"):
		return &AgentACPRuntimeAlert{
			Severity: "error",
			Title:    "Agent 运行超时",
			Message:  "本轮运行已达到时间上限。上游模型可能长时间没有继续返回内容；如果还没看到编辑确认，通常表示模型没有成功发起编辑工具调用。",
			Reason:   "agent_run_timeout",
			Detail:   compactRuntimeAlertDetail(firstNonEmptyRuntimeAlertDetail(errText, contextText)),
		}
	case strings.Contains(normalized, "idle timeout waiting for sse") ||
		strings.Contains(normalized, "responsestreamdisconnected"):
		return &AgentACPRuntimeAlert{
			Severity: "warning",
			Title:    "模型流断开",
			Message:  "上游模型流长时间没有继续返回内容。ACP 可能需要重连或重试后才能继续。",
			Reason:   "upstream_stream_idle_timeout",
			Detail:   compactRuntimeAlertDetail(firstNonEmptyRuntimeAlertDetail(errText, contextText)),
		}
	default:
		return nil
	}
}

func acpPromptIdleDetail(idleErr *acpPromptIdleError) string {
	if idleErr == nil {
		return ""
	}
	return fmt.Sprintf(
		"no session update for %s; timeout=%s; retryable=%t; updates=%d; tool_calls=%d; mutating_tool_calls=%d",
		formatRuntimeAlertDuration(idleErr.Elapsed),
		formatRuntimeAlertDuration(idleErr.Timeout),
		idleErr.Retryable,
		idleErr.UpdateCount,
		idleErr.ToolCallCount,
		idleErr.MutatingToolCalls,
	)
}

func firstNonEmptyRuntimeAlertDetail(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func compactRuntimeAlertDetail(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	const maxDetailLen = 220
	if len(value) <= maxDetailLen {
		return value
	}
	return value[:maxDetailLen-3] + "..."
}

func formatRuntimeAlertDuration(duration time.Duration) string {
	if duration < time.Minute {
		return fmt.Sprintf("%ds", int(duration.Round(time.Second).Seconds()))
	}
	return fmt.Sprintf("%dm%02ds", int(duration/time.Minute), int((duration%time.Minute)/time.Second))
}
