package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	service "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
)

// AgentPermissionResolver supplies ACP permission decision operations.
type AgentPermissionResolver interface {
	ResolveAgentPermission(service.AgentPermissionDecisionRequest) (service.AgentSessionStatus, int, error)
}

// AgentPermissions handles ACP permission decision HTTP routes.
type AgentPermissions struct {
	resolver AgentPermissionResolver
}

// NewAgentPermissions returns an ACP permission route handler.
func NewAgentPermissions(resolver AgentPermissionResolver) AgentPermissions {
	return AgentPermissions{resolver: resolver}
}

// HandleDecideAgentPermission resolves one pending ACP permission request.
func (handler AgentPermissions) HandleDecideAgentPermission(context *gin.Context) {
	if handler.resolver == nil {
		httpresponse.Error(context, http.StatusServiceUnavailable, "agent runtime is unavailable")
		return
	}
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}
	requestID, ok := requiredPathParam(context, "requestId", "requestId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.AgentPermissionDecisionRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	payload.SessionID = sessionID
	payload.RequestID = requestID
	status, code, err := handler.resolver.ResolveAgentPermission(payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, code, err)
		return
	}
	httpresponse.OK(context, status)
}
