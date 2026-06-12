package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
	serviceevents "github.com/mediago-dev/mediago-drama/packages/server/internal/service/events"
)

// AgentEventService supplies live and replayed agent events.
type AgentEventService interface {
	LoadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]service.AgentEvent, error)
	SubscribeAgentEvents() (<-chan service.AgentEvent, func())
	NewEventID() string
}

// AgentEvents handles agent event stream routes.
type AgentEvents struct {
	service AgentEventService
}

// NewAgentEvents returns an agent event route handler.
func NewAgentEvents(service AgentEventService) AgentEvents {
	return AgentEvents{service: service}
}

// HandleAgentEvents streams live agent events using server-sent events.
func (handler AgentEvents) HandleAgentEvents(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}
	afterSequence := maxAgentEventSequence(
		parseAgentEventSequence(context.Query("after")),
		parseAgentEventSequence(context.GetHeader("Last-Event-ID")),
	)

	flusher, ok := context.Writer.(http.Flusher)
	if !ok {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}

	context.Header("Cache-Control", "no-cache")
	context.Header("Connection", "keep-alive")
	context.Header("Content-Type", "text/event-stream")
	context.Status(http.StatusOK)

	events, unsubscribe := handler.service.SubscribeAgentEvents()
	defer unsubscribe()
	slog.Debug("agent event stream subscribed", "session_id", sessionID, "project_id", projectID, "after_sequence", afterSequence)
	defer slog.Debug("agent event stream closed", "session_id", sessionID, "project_id", projectID)

	writeSSE(context.Writer, service.AgentEvent{
		ID:        handler.service.NewEventID(),
		SessionID: sessionID,
		ProjectID: projectID,
		Type:      "agent.session.connected",
		Message:   "已连接到本地 Agent 事件流。",
		CreatedAt: timestamp.NowRFC3339Nano(),
	})
	flusher.Flush()

	replayed, err := handler.service.LoadAgentEvents(projectID, sessionID, afterSequence, 1000)
	if err != nil {
		slog.Warn(
			"agent event replay failed",
			"session_id", sessionID,
			"project_id", projectID,
			"after_sequence", afterSequence,
			"error", err,
		)
	} else {
		for _, event := range replayed {
			writeSSE(context.Writer, event)
			flusher.Flush()
		}
	}
	writeSSE(context.Writer, service.AgentEvent{
		ID:        handler.service.NewEventID(),
		SessionID: sessionID,
		ProjectID: projectID,
		Type:      "agent.session.replay.completed",
		Message:   "本地 Agent 历史事件已同步。",
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
			if !agentEventMatchesSubscription(event, sessionID, projectID) {
				continue
			}
			heartbeat.Reset(sseHeartbeatInterval)
			writeSSE(context.Writer, event)
			if serviceevents.IsGuaranteedAgentEventPayload(event) {
				slog.Debug(
					"agent terminal event sent",
					"session_id", event.SessionID,
					"run_id", event.RunID,
					"type", event.Type,
				)
			} else if event.Type != "agent.document.edit.delta" {
				slog.Debug(
					"agent event sent",
					"session_id", event.SessionID,
					"run_id", event.RunID,
					"type", event.Type,
				)
			}
			flusher.Flush()
		}
	}
}

func agentEventMatchesSubscription(event service.AgentEvent, sessionID string, projectID string) bool {
	if event.Type == service.ProjectBriefUpdatedEventType {
		return projectID == "" || event.ProjectID == "" || event.ProjectID == projectID
	}
	if event.SessionID != "" && event.SessionID != sessionID {
		return false
	}
	if event.ProjectID != "" && projectID != "" && event.ProjectID != projectID {
		return false
	}
	return true
}

func parseAgentEventSequence(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	sequence, err := strconv.ParseInt(value, 10, 64)
	if err != nil || sequence < 0 {
		return 0
	}
	return sequence
}

func maxAgentEventSequence(values ...int64) int64 {
	var maxSequence int64
	for _, value := range values {
		if value > maxSequence {
			maxSequence = value
		}
	}
	return maxSequence
}

func writeSSE(writer http.ResponseWriter, event service.AgentEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}

	if !isAgentEventStreamControlEvent(event.Type) {
		eventID := event.ID
		if event.Sequence > 0 {
			eventID = fmt.Sprintf("%d", event.Sequence)
		}
		fmt.Fprintf(writer, "id: %s\n", eventID)
	}
	fmt.Fprintf(writer, "event: %s\n", event.Type)
	fmt.Fprintf(writer, "data: %s\n\n", body)
}

func isAgentEventStreamControlEvent(eventType string) bool {
	return eventType == "agent.session.connected" || eventType == "agent.session.replay.completed"
}
