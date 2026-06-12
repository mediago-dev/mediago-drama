package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
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

// HandleGetAgentChat returns chat state.
func (handler AgentChat) HandleGetAgentChat(context *gin.Context) {
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

// HandleAppendAgentChat appends chat messages.
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

// HandleDeleteAgentChat clears chat state.
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
