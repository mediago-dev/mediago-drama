package acp

import (
	"context"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

func TestACPClientRequestPermissionTimeoutPublishesResolution(t *testing.T) {
	events := make(chan agentEvent, 8)
	client := &acpClient{
		publish: func(event agentEvent) {
			events <- event
		},
		permissionTimeout: 30 * time.Millisecond,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resultCh := make(chan acp.RequestPermissionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		response, err := client.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: "session-1",
			ToolCall: acp.ToolCallUpdate{
				ToolCallId: "call-edit",
				Title:      acp.Ptr("写入 README"),
			},
			Options: []acp.PermissionOption{
				{Kind: acp.PermissionOptionKindAllowOnce, Name: "Allow once", OptionId: "allow-once"},
			},
		})
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- response
	}()

	requestID := waitForPermissionRequestEvent(t, events).RequestID

	select {
	case err := <-errCh:
		t.Fatalf("RequestPermission returned error: %v", err)
	case response := <-resultCh:
		if response.Outcome.Cancelled == nil {
			t.Fatalf("response = %#v, want cancelled outcome after timeout", response)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for RequestPermission")
	}

	resolution := waitForPermissionResolvedEvent(t, events, requestID)
	if resolution.ACP.Status != permissionResolutionExpired {
		t.Fatalf("status = %q, want %q", resolution.ACP.Status, permissionResolutionExpired)
	}
	if pending := client.PendingPermissions(); len(pending) != 0 {
		t.Fatalf("pending after timeout = %#v, want empty", pending)
	}
}

func TestACPClientRequestPermissionPublishesResolutionOnDecision(t *testing.T) {
	events := make(chan agentEvent, 8)
	client := &acpClient{
		publish: func(event agentEvent) {
			events <- event
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resultCh := make(chan acp.RequestPermissionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		response, err := client.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: "session-1",
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "call-edit"},
			Options: []acp.PermissionOption{
				{Kind: acp.PermissionOptionKindAllowOnce, Name: "Allow once", OptionId: "allow-once"},
			},
		})
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- response
	}()

	requestID := waitForPermissionRequestEvent(t, events).RequestID
	if err := client.ResolvePermission(requestID, "allow-once", false); err != nil {
		t.Fatalf("ResolvePermission returned error: %v", err)
	}

	select {
	case err := <-errCh:
		t.Fatalf("RequestPermission returned error: %v", err)
	case response := <-resultCh:
		if response.Outcome.Selected == nil || response.Outcome.Selected.OptionId != "allow-once" {
			t.Fatalf("response = %#v, want selected allow-once", response)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for RequestPermission")
	}

	resolution := waitForPermissionResolvedEvent(t, events, requestID)
	if resolution.ACP.Status != permissionResolutionSelected {
		t.Fatalf("status = %q, want %q", resolution.ACP.Status, permissionResolutionSelected)
	}
}

func TestACPClientRequestPermissionPublishesResolutionOnContextCancel(t *testing.T) {
	events := make(chan agentEvent, 8)
	client := &acpClient{
		publish: func(event agentEvent) {
			events <- event
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	resultCh := make(chan acp.RequestPermissionResponse, 1)
	errCh := make(chan error, 1)
	go func() {
		response, err := client.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: "session-1",
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "call-edit"},
			Options: []acp.PermissionOption{
				{Kind: acp.PermissionOptionKindRejectOnce, Name: "Reject", OptionId: "reject"},
			},
		})
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- response
	}()

	requestID := waitForPermissionRequestEvent(t, events).RequestID
	cancel()

	select {
	case err := <-errCh:
		t.Fatalf("RequestPermission returned error: %v", err)
	case response := <-resultCh:
		if response.Outcome.Cancelled == nil {
			t.Fatalf("response = %#v, want cancelled outcome", response)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for RequestPermission")
	}

	resolution := waitForPermissionResolvedEvent(t, events, requestID)
	if resolution.ACP.Status != permissionResolutionCancelled {
		t.Fatalf("status = %q, want %q", resolution.ACP.Status, permissionResolutionCancelled)
	}
}

func TestACPClientPermissionTimeoutDuration(t *testing.T) {
	client := &acpClient{}
	if duration := client.permissionTimeoutDuration(); duration != defaultPermissionTimeout {
		t.Fatalf("duration = %v, want default %v", duration, defaultPermissionTimeout)
	}

	t.Setenv(permissionTimeoutEnv, "10m")
	if duration := client.permissionTimeoutDuration(); duration != 10*time.Minute {
		t.Fatalf("duration = %v, want env override 10m", duration)
	}

	t.Setenv(permissionTimeoutEnv, "not-a-duration")
	if duration := client.permissionTimeoutDuration(); duration != defaultPermissionTimeout {
		t.Fatalf("duration = %v, want default for invalid env", duration)
	}

	client.permissionTimeout = time.Second
	if duration := client.permissionTimeoutDuration(); duration != time.Second {
		t.Fatalf("duration = %v, want explicit client override", duration)
	}
}

func waitForPermissionResolvedEvent(t *testing.T, events <-chan agentEvent, requestID string) agentEvent {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type != "agent.acp" || event.ACP == nil || event.ACP.Kind != "permissionResolved" {
				continue
			}
			if event.ACP.PermissionRequest == nil || event.ACP.PermissionRequest.RequestID != requestID {
				t.Fatalf("resolution request = %#v, want request id %q", event.ACP.PermissionRequest, requestID)
			}
			return event
		case <-timeout:
			t.Fatal("timed out waiting for permission resolved event")
			return agentEvent{}
		}
	}
}
