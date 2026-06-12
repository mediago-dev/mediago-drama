package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	serviceworkspaceevent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/workspaceevent"
)

// WorkspaceEventService supplies live workspace file events.
type WorkspaceEventService interface {
	SubscribeWorkspaceEvents() (<-chan serviceworkspaceevent.Event, func())
	NewWorkspaceEventID() string
}

// WorkspaceEvents handles workspace event stream routes.
type WorkspaceEvents struct {
	service WorkspaceEventService
}

// NewWorkspaceEvents returns a workspace event route handler.
func NewWorkspaceEvents(service WorkspaceEventService) WorkspaceEvents {
	return WorkspaceEvents{service: service}
}

// HandleWorkspaceEvents streams live workspace file events using SSE.
func (handler WorkspaceEvents) HandleWorkspaceEvents(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	flusher, ok := context.Writer.(http.Flusher)
	if !ok {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}

	context.Header("Cache-Control", "no-cache")
	context.Header("Connection", "keep-alive")
	context.Header("Content-Type", "text/event-stream")
	context.Status(http.StatusOK)

	events, unsubscribe := handler.service.SubscribeWorkspaceEvents()
	defer unsubscribe()

	writeWorkspaceSSE(context.Writer, serviceworkspaceevent.Event{
		ID:        handler.service.NewWorkspaceEventID(),
		Type:      serviceworkspaceevent.ConnectedEventType,
		ProjectID: projectID,
		Message:   "已连接到工作区文件事件流。",
		CreatedAt: timestamp.NowRFC3339Nano(),
	})
	flusher.Flush()

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-context.Request.Context().Done():
			return
		case <-heartbeat.C:
			writeSSEHeartbeat(context.Writer)
			flusher.Flush()
		case event := <-events:
			if projectID != "" && event.ProjectID != "" && event.ProjectID != projectID {
				continue
			}
			heartbeat.Reset(sseHeartbeatInterval)
			writeWorkspaceSSE(context.Writer, event)
			flusher.Flush()
		}
	}
}

func writeWorkspaceSSE(writer http.ResponseWriter, event serviceworkspaceevent.Event) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Fprintf(writer, "id: %s\n", event.ID)
	fmt.Fprintf(writer, "event: %s\n", event.Type)
	fmt.Fprintf(writer, "data: %s\n\n", body)
}
