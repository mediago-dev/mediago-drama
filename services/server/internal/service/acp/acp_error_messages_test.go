package acp

import (
	"context"
	"testing"

	acp "github.com/coder/acp-go-sdk"
)

func TestFriendlyACPProviderErrorMessageDetectsInsufficientQuota(t *testing.T) {
	raw := `{"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`

	message := friendlyACPProviderErrorMessage(raw)
	if message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("message = %q, want balance hint", message)
	}
}

func TestParseACPFinalResponseMapsProviderQuotaError(t *testing.T) {
	response := ParseACPFinalResponse(
		`{"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`,
		agentRunRequest{},
	)

	if response.Message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("message = %q, want balance hint", response.Message)
	}
}

func TestRuntimeAlertForACPPromptErrorDetectsInsufficientQuota(t *testing.T) {
	alert := runtimeAlertForACPPromptError(errString(`provider failed: {"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`), nil)
	if alert == nil {
		t.Fatal("alert = nil, want quota alert")
	}
	if alert.Message != apiKeyBalanceInsufficientMessage || alert.Reason != "api_key_balance_insufficient" {
		t.Fatalf("alert = %#v, want balance alert", alert)
	}
}

func TestACPClientSessionUpdateRecordsProviderQuotaError(t *testing.T) {
	events := []agentEvent{}
	client := &acpClient{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
	}
	client.setAcceptingSessionUpdates(true)

	err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateToolCall(
			"call-model",
			acp.WithUpdateTitle("模型调用"),
			acp.WithUpdateStatus(acp.ToolCallStatusFailed),
			acp.WithUpdateRawOutput(map[string]any{
				"error": map[string]any{
					"message": "credit insufficient",
					"type":    "insufficient_quota",
					"code":    "400003",
				},
			}),
		),
	})
	if err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
	if client.runtimeErrorText() != apiKeyBalanceInsufficientMessage {
		t.Fatalf("runtime error = %q, want balance hint", client.runtimeErrorText())
	}
	if len(events) != 1 || events[0].Message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("events = %#v, want one balance event", events)
	}
}

func TestACPStderrWriterRecordsProviderQuotaError(t *testing.T) {
	events := []agentEvent{}
	recorded := ""
	writer := acpStderrWriter{
		publish: func(event agentEvent) {
			events = append(events, event)
		},
		recordRuntimeError: func(message string) {
			recorded = message
		},
	}

	_, err := writer.Write([]byte(`{"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`))
	if err != nil {
		t.Fatalf("Write returned error: %v", err)
	}
	if recorded != apiKeyBalanceInsufficientMessage {
		t.Fatalf("recorded = %q, want balance hint", recorded)
	}
	if len(events) != 1 || events[0].Message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("events = %#v, want one balance event", events)
	}
}

type errString string

func (err errString) Error() string {
	return string(err)
}
