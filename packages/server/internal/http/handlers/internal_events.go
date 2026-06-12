package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
)

// InternalEventPublisher publishes internal agent event payloads.
type InternalEventPublisher interface {
	PublishInternalAgentEvent(raw json.RawMessage) (int, error)
}

// InternalEvents handles internal event publish routes.
type InternalEvents struct {
	bridgeToken string
	publisher   InternalEventPublisher
}

// NewInternalEvents returns an internal event route handler.
func NewInternalEvents(bridgeToken string, publisher InternalEventPublisher) InternalEvents {
	return InternalEvents{bridgeToken: bridgeToken, publisher: publisher}
}

// HandleInternalPublishEvent publishes an internal event.
func (handler InternalEvents) HandleInternalPublishEvent(context *gin.Context) {
	token := strings.TrimSpace(strings.TrimPrefix(context.GetHeader("Authorization"), "Bearer "))
	if handler.bridgeToken == "" || token == "" || token != handler.bridgeToken {
		httpresponse.Error(context, http.StatusUnauthorized, "unauthorized internal event publish request")
		return
	}

	raw, err := io.ReadAll(context.Request.Body)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	status, err := handler.publisher.PublishInternalAgentEvent(json.RawMessage(raw))
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	context.Status(http.StatusNoContent)
}
