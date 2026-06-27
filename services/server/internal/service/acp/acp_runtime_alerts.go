package acp

import (
	"context"
	"strings"
)

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

func runtimeAlertForACPPromptError(err error, contextErr error) *AgentACPRuntimeAlert {
	if err == nil && contextErr == nil {
		return nil
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
	default:
		return nil
	}
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
