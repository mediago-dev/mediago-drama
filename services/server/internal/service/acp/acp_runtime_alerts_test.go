package acp

import (
	"context"
	"testing"
)

func TestRuntimeAlertForACPPromptErrorDetectsRunTimeout(t *testing.T) {
	alert := runtimeAlertForACPPromptError(context.DeadlineExceeded, context.DeadlineExceeded)
	if alert == nil {
		t.Fatal("alert = nil, want timeout alert")
	}
	if alert.Reason != "agent_run_timeout" || alert.Severity != "error" {
		t.Fatalf("alert = %#v, want run timeout error", alert)
	}
}

func TestACPStderrWriterDoesNotPublishRuntimeAlertForIdleTimeout(t *testing.T) {
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
	if len(events) != 1 {
		t.Fatalf("events = %d, want runtime log only", len(events))
	}
	if events[0].ACP == nil || events[0].ACP.Kind != ACPRuntimeLogKind {
		t.Fatalf("event = %#v, want runtime log", events[0])
	}
}
