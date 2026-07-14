package acp

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

const (
	defaultPermissionTimeout = 30 * time.Minute
	permissionTimeoutEnv     = "MEDIAGO_ACP_PERMISSION_TIMEOUT"
)

// Permission resolution statuses published with permissionResolved events.
const (
	permissionResolutionSelected  = "selected"
	permissionResolutionCancelled = "cancelled"
	permissionResolutionExpired   = "expired"
)

// ResolvePermission resolves a pending permission request for an active session.
func (runner *acpAgentRunner) ResolvePermission(sessionID string, requestID string, optionID string, cancelled bool) error {
	value, ok := runner.activeClients.Load(strings.TrimSpace(sessionID))
	if !ok {
		return fmt.Errorf("active ACP session not found")
	}
	client, ok := value.(*acpClient)
	if !ok || client == nil {
		return fmt.Errorf("active ACP session is unavailable")
	}
	return client.ResolvePermission(requestID, optionID, cancelled)
}

// PendingPermissions lists active permission requests for an active session.
func (runner *acpAgentRunner) PendingPermissions(sessionID string) []AgentACPPermissionRequest {
	value, ok := runner.activeClients.Load(strings.TrimSpace(sessionID))
	if !ok {
		return nil
	}
	client, ok := value.(*acpClient)
	if !ok || client == nil {
		return nil
	}
	return client.PendingPermissions()
}

func (client *acpClient) RequestPermission(ctx context.Context, params acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	title := "ACP 请求权限"
	if params.ToolCall.Title != nil && strings.TrimSpace(*params.ToolCall.Title) != "" {
		title = strings.TrimSpace(*params.ToolCall.Title)
	}

	if len(params.Options) == 0 {
		acpLog().Debug("acp permission cancelled because no options were provided", client.logAttrs("title", title)...)
		return acp.RequestPermissionResponse{
			Outcome: acp.RequestPermissionOutcome{
				Cancelled: &acp.RequestPermissionOutcomeCancelled{},
			},
		}, nil
	}

	requestID := MustRandomID("permission")
	decisionCh := make(chan permissionDecision, 1)
	permissionRequest := AgentACPPermissionRequest{
		RequestID: requestID,
		ToolCall:  MapACPPermissionToolCall(params.ToolCall),
		Options:   MapACPPermissionOptions(params.Options),
		CreatedAt: timestamp.NowRFC3339Nano(),
	}
	client.pendingPermissions.Store(requestID, decisionCh)
	client.pendingRequests.Store(requestID, permissionRequest)
	defer client.clearPendingPermission(requestID)

	acpLog().Info("acp permission requested", client.logAttrs("title", title, "request_id", requestID, "options", len(params.Options))...)
	requestedAt := time.Now()
	client.flushThoughts()
	client.publishEvent(agentEvent{
		Type:    "agent.acp",
		Message: "权限请求：" + title,
		ACP: &agentACPEvent{
			Kind:              "permissionRequest",
			PermissionRequest: &permissionRequest,
		},
	})
	client.publishEvent(agentEvent{
		Type:    AgentUIEventType,
		Message: "需要确认工具权限",
		A2UI:    BuildAgentPermissionA2UI(permissionRequest),
	})

	timeout := time.NewTimer(client.permissionTimeoutDuration())
	defer timeout.Stop()
	select {
	case decision := <-decisionCh:
		if decision.Cancelled {
			acpLog().Info("acp permission cancelled by user", client.logAttrs("title", title, "request_id", requestID, "wait_ms", time.Since(requestedAt).Milliseconds())...)
			client.publishPermissionResolution(requestID, permissionResolutionCancelled, title)
			return acp.RequestPermissionResponse{
				Outcome: acp.RequestPermissionOutcome{
					Cancelled: &acp.RequestPermissionOutcomeCancelled{},
				},
			}, nil
		}
		acpLog().Info("acp permission selected by user", client.logAttrs("title", title, "request_id", requestID, "option_id", decision.OptionID, "wait_ms", time.Since(requestedAt).Milliseconds())...)
		client.publishPermissionResolution(requestID, permissionResolutionSelected, title)
		return acp.RequestPermissionResponse{
			Outcome: acp.RequestPermissionOutcome{
				Selected: &acp.RequestPermissionOutcomeSelected{OptionId: decision.OptionID},
			},
		}, nil
	case <-timeout.C:
		acpLog().Warn("acp permission timed out", client.logAttrs("title", title, "request_id", requestID, "wait_ms", time.Since(requestedAt).Milliseconds())...)
		client.publishPermissionResolution(requestID, permissionResolutionExpired, title)
		return acp.RequestPermissionResponse{
			Outcome: acp.RequestPermissionOutcome{
				Cancelled: &acp.RequestPermissionOutcomeCancelled{},
			},
		}, nil
	case <-ctx.Done():
		acpLog().Info("acp permission cancelled by context", client.logAttrs("title", title, "request_id", requestID, "wait_ms", time.Since(requestedAt).Milliseconds())...)
		client.publishPermissionResolution(requestID, permissionResolutionCancelled, title)
		return acp.RequestPermissionResponse{
			Outcome: acp.RequestPermissionOutcome{
				Cancelled: &acp.RequestPermissionOutcomeCancelled{},
			},
		}, nil
	}
}

// permissionTimeoutDuration resolves how long a permission request stays
// pending before it is auto-cancelled. Override with MEDIAGO_ACP_PERMISSION_TIMEOUT
// (a Go duration string such as "10m" or "1h").
func (client *acpClient) permissionTimeoutDuration() time.Duration {
	if client.permissionTimeout > 0 {
		return client.permissionTimeout
	}
	if raw := strings.TrimSpace(os.Getenv(permissionTimeoutEnv)); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			return parsed
		}
		acpLog().Warn("invalid acp permission timeout, using default", "env", permissionTimeoutEnv, "value", raw, "default", defaultPermissionTimeout)
	}
	return defaultPermissionTimeout
}

// publishPermissionResolution clears one pending permission request and tells
// every connected client to retract its dialog. The event is persisted with the
// session history so replays remove requests that were resolved or expired.
func (client *acpClient) publishPermissionResolution(requestID string, status string, title string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}
	client.clearPendingPermission(requestID)
	message := "权限请求已处理：" + title
	switch status {
	case permissionResolutionCancelled:
		message = "权限请求已取消：" + title
	case permissionResolutionExpired:
		message = "权限请求超时，已自动取消：" + title
	}
	client.publishEvent(agentEvent{
		Type:    "agent.acp",
		Message: message,
		ACP: &agentACPEvent{
			Kind:              "permissionResolved",
			Status:            status,
			PermissionRequest: &AgentACPPermissionRequest{RequestID: requestID},
		},
	})
}

// ResolvePermission sends a user decision to a pending ACP permission request.
func (client *acpClient) ResolvePermission(requestID string, optionID string, cancelled bool) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return fmt.Errorf("missing permission request id")
	}
	decision := permissionDecision{OptionID: acp.PermissionOptionId(strings.TrimSpace(optionID)), Cancelled: cancelled}
	if !cancelled && decision.OptionID == "" {
		return fmt.Errorf("missing permission option id")
	}
	if !client.resolvePendingPermission(requestID, decision) {
		return fmt.Errorf("permission request not found")
	}
	return nil
}

func (client *acpClient) resolvePendingPermission(requestID string, decision permissionDecision) bool {
	value, ok := client.pendingPermissions.Load(strings.TrimSpace(requestID))
	if !ok {
		return false
	}
	decisionCh, ok := value.(chan permissionDecision)
	if !ok {
		return false
	}
	select {
	case decisionCh <- decision:
		client.pendingRequests.Delete(strings.TrimSpace(requestID))
		return true
	default:
		return false
	}
}

func (client *acpClient) PendingPermissions() []AgentACPPermissionRequest {
	requests := []AgentACPPermissionRequest{}
	client.pendingRequests.Range(func(_, value any) bool {
		request, ok := value.(AgentACPPermissionRequest)
		if !ok || strings.TrimSpace(request.RequestID) == "" {
			return true
		}
		request.Options = append([]AgentACPPermissionOption(nil), request.Options...)
		requests = append(requests, request)
		return true
	})
	sort.Slice(requests, func(first int, second int) bool {
		return requests[first].CreatedAt < requests[second].CreatedAt
	})
	return requests
}

func (client *acpClient) clearPendingPermission(requestID string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}
	client.pendingPermissions.Delete(requestID)
	client.pendingRequests.Delete(requestID)
}

func (client *acpClient) cancelPendingPermissions() {
	client.pendingPermissions.Range(func(key, value any) bool {
		requestID, ok := key.(string)
		if !ok {
			return true
		}
		decisionCh, ok := value.(chan permissionDecision)
		if !ok {
			client.clearPendingPermission(requestID)
			return true
		}
		select {
		case decisionCh <- permissionDecision{Cancelled: true}:
		default:
		}
		client.clearPendingPermission(requestID)
		return true
	})
}
