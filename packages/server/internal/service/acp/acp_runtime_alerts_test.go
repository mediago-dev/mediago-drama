package acp

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRuntimeAlertForACPStderrDetectsIdleTimeoutReconnect(t *testing.T) {
	alert := runtimeAlertForACPStderr(`Handled error during turn: Reconnecting... 1/5 Some(ResponseStreamDisconnected { http_status_code: None }) Some("stream disconnected before completion: idle timeout waiting for SSE")`)
	if alert == nil {
		t.Fatal("alert = nil, want upstream stream alert")
	}
	if alert.Reason != "upstream_stream_idle_timeout" || alert.Severity != "warning" {
		t.Fatalf("alert = %#v, want upstream warning", alert)
	}
	if !strings.Contains(alert.Message, "编辑确认") {
		t.Fatalf("message = %q, want permission explanation", alert.Message)
	}
}

func TestRuntimeAlertForACPStderrIgnoresGenericToolErrors(t *testing.T) {
	alert := runtimeAlertForACPStderr("apply_patch verification failed: invalid patch")
	if alert != nil {
		t.Fatalf("alert = %#v, want nil", alert)
	}
}

func TestRuntimeAlertForACPPromptErrorDetectsRunTimeout(t *testing.T) {
	alert := runtimeAlertForACPPromptError(context.DeadlineExceeded, context.DeadlineExceeded)
	if alert == nil {
		t.Fatal("alert = nil, want timeout alert")
	}
	if alert.Reason != "agent_run_timeout" || alert.Severity != "error" {
		t.Fatalf("alert = %#v, want run timeout error", alert)
	}
}

func TestRuntimeAlertForACPPromptIdleAfterMutation(t *testing.T) {
	alert := runtimeAlertForACPPromptError(&acpPromptIdleError{acpPromptIdleSnapshot: acpPromptIdleSnapshot{
		Elapsed:           2 * time.Minute,
		Timeout:           2 * time.Minute,
		UpdateCount:       3,
		ToolCallCount:     1,
		MutatingToolCalls: 1,
		Retryable:         false,
	}}, nil)
	if alert == nil {
		t.Fatal("alert = nil, want idle alert")
	}
	if alert.Reason != "acp_prompt_idle_after_mutation" || !strings.Contains(alert.Message, "没有自动重试") {
		t.Fatalf("alert = %#v, want non-retryable idle alert", alert)
	}
	if !strings.Contains(alert.Detail, "mutating_tool_calls=1") {
		t.Fatalf("detail = %q, want mutation count", alert.Detail)
	}
}

func TestACPPromptIdleRetryAlertShowsAttempt(t *testing.T) {
	alert := acpPromptIdleRetryAlert(&acpPromptIdleError{acpPromptIdleSnapshot: acpPromptIdleSnapshot{
		Elapsed:     2 * time.Minute,
		Timeout:     2 * time.Minute,
		UpdateCount: 2,
		Retryable:   true,
	}}, 1, 2)
	if alert.Reason != "acp_prompt_idle_retrying" || !strings.Contains(alert.Message, "第 1/2 次") {
		t.Fatalf("alert = %#v, want retrying alert with attempt", alert)
	}
}

func TestACPClientMarkPromptStalledPublishesOnce(t *testing.T) {
	client := &acpClient{}
	client.beginPromptMetrics()
	client.setAcceptingSessionUpdates(true)

	client.mu.Lock()
	client.promptLastUpdateAt = time.Now().Add(-2 * time.Second)
	client.mu.Unlock()

	if _, stalled := client.markPromptStalled(time.Second); !stalled {
		t.Fatal("stalled = false, want true after threshold")
	}
	if _, stalled := client.markPromptStalled(time.Second); stalled {
		t.Fatal("stalled = true, want one alert per prompt")
	}
}

func TestACPStderrWriterPublishesRuntimeAlertForIdleTimeout(t *testing.T) {
	events := []agentEvent{}
	writer := acpStderrWriter{
		sessionID: "session-1",
		runID:     "run-1",
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}

	_, err := writer.Write([]byte(`Reconnecting... 1/5 Some("idle timeout waiting for SSE")`))
	if err != nil {
		t.Fatalf("Write returned error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %d, want runtime log and alert", len(events))
	}
	if events[1].ACP == nil || events[1].ACP.Kind != "runtimeError" || events[1].ACP.RuntimeAlert == nil {
		t.Fatalf("alert event = %#v, want runtimeError alert", events[1])
	}
}
