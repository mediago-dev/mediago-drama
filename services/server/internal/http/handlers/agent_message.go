package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

// AgentMessageService accepts agent messages.
type AgentMessageService interface {
	SubmitAgentMessage(payload service.AgentMessageRequest) (service.AgentMessageResponse, int, error)
}

// AgentMessages handles agent message routes.
type AgentMessages struct {
	service AgentMessageService
}

// NewAgentMessages returns an agent message route handler.
func NewAgentMessages(service AgentMessageService) AgentMessages {
	return AgentMessages{service: service}
}

// HandleAgentMessage godoc
// @Summary 提交 Agent 消息
// @Description 向 Agent 会话提交消息并启动后台运行。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Agent message payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/sessions/{sessionId}/messages [post]
func (handler AgentMessages) HandleAgentMessage(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.AgentMessageRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	payload.ProjectID = projectID
	payload.SessionID = sessionID
	response, status, err := handler.service.SubmitAgentMessage(payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}
