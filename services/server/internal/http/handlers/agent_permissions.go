package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
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

// HandleDecideAgentPermission godoc
// @Summary 处理 Agent 权限请求
// @Description 接受或拒绝一个运行中的 Agent ACP 权限请求。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param sessionId path string true "Session ID"
// @Param requestId path string true "Permission request ID"
// @Param payload body SwaggerObject true "Permission decision payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/sessions/{sessionId}/permission-requests/{requestId}/decision [post]
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
