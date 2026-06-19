package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

// AgentChatStore supplies agent chat operations.
type AgentChatStore interface {
	LoadAgentChat(projectID string, sessionID string) (service.AgentChatStateResponse, error)
	AppendAgentMessages(projectID string, request service.AgentChatAppendRequest) (service.AgentChatStateResponse, error)
	ClearAgentChat(projectID string) (service.AgentChatStateResponse, error)
}

// AgentChat handles agent chat HTTP routes.
type AgentChat struct {
	store              AgentChatStore
	pendingPermissions func(sessionID string) []service.AgentACPPermissionRequest
}

// NewAgentChat returns an agent chat route handler.
func NewAgentChat(store AgentChatStore, pendingPermissions ...func(sessionID string) []service.AgentACPPermissionRequest) AgentChat {
	handler := AgentChat{store: store}
	if len(pendingPermissions) > 0 {
		handler.pendingPermissions = pendingPermissions[0]
	}
	return handler
}

// HandleGetAgentChat godoc
// @Summary 获取项目 Agent 聊天
// @Description 返回项目默认 Agent 聊天状态。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/chat [get]
func (handler AgentChat) HandleGetAgentChat(context *gin.Context) {
	writeNoStoreHeaders(context)
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	sessionID := pathParam(context, "sessionId")
	state, err := handler.store.LoadAgentChat(projectID, sessionID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if handler.pendingPermissions != nil {
		sessionID := state.SessionID
		if sessionID == "" {
			sessionID = pathParam(context, "sessionId")
		}
		state.PendingPermissions = handler.pendingPermissions(sessionID)
	}

	httpresponse.OK(context, state)
}

// HandleGetAgentSessionChat godoc
// @Summary 获取会话 Agent 聊天
// @Description 返回指定 Agent 会话的聊天状态。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Param sessionId path string true "Session ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/sessions/{sessionId}/chat [get]
func (handler AgentChat) HandleGetAgentSessionChat(context *gin.Context) {
	handler.HandleGetAgentChat(context)
}

// HandleAppendAgentChat godoc
// @Summary 追加 Agent 聊天消息
// @Description 向项目默认 Agent 聊天追加消息。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Chat append payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/chat/messages [post]
func (handler AgentChat) HandleAppendAgentChat(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.AgentChatAppendRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	payload.ProjectID = projectID
	state, err := handler.store.AppendAgentMessages(projectID, payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, state)
}

// HandleDeleteAgentChat godoc
// @Summary 清空 Agent 聊天
// @Description 删除项目默认 Agent 聊天状态。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/chat [delete]
func (handler AgentChat) HandleDeleteAgentChat(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	state, err := handler.store.ClearAgentChat(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, state)
}
