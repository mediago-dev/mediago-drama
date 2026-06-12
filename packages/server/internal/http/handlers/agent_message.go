package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	service "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
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

// HandleAgentMessage starts an agent run.
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
