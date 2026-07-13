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
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	serviceevents "github.com/mediago-dev/mediago-drama/services/server/internal/service/events"
)

// agentEventReplayPageSize bounds how many history events are read per replay
// page; the handler loops pages until the session history is exhausted.
const agentEventReplayPageSize = 1000

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

// HandleAgentEvents godoc
// @Summary 订阅 Agent 会话事件
// @Description 使用 SSE 订阅指定 Agent 会话的运行事件。
// @Tags Agent
// @Produce text/event-stream
// @Param projectId path string true "Project ID"
// @Param sessionId path string true "Session ID"
// @Param after query int false "Last seen event sequence"
// @Param limit query int false "Replay event limit"
// @Success 200 {string} string "SSE stream"
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/sessions/{sessionId}/events [get]
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

	// Replay the full history in pages instead of a single capped batch, so a long
	// session is never silently truncated (which previously left the resumed live
	// state stranded behind the most recent events).
	replayCursor := afterSequence
	for {
		page, err := handler.service.LoadAgentEvents(projectID, sessionID, replayCursor, agentEventReplayPageSize)
		if err != nil {
			slog.Warn(
				"agent event replay failed",
				"session_id", sessionID,
				"project_id", projectID,
				"after_sequence", replayCursor,
				"error", err,
			)
			break
		}
		pageStartCursor := replayCursor
		for _, event := range page {
			writeSSE(context.Writer, event)
			flusher.Flush()
			if event.Sequence > replayCursor {
				replayCursor = event.Sequence
			}
		}
		// A short page means the history is exhausted; a page that fails to advance
		// the cursor guards against an unexpected non-progressing read.
		if len(page) < agentEventReplayPageSize || replayCursor == pageStartCursor {
			break
		}
		select {
		case <-context.Request.Context().Done():
			return
		default:
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
	replayWatermark := replayCursor

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-context.Request.Context().Done():
			return
		case <-heartbeat.C:
			writeSSEHeartbeat(context.Writer)
			flusher.Flush()
		case event, open := <-events:
			if !open {
				return
			}
			if !agentEventMatchesSubscription(event, sessionID, projectID) {
				continue
			}
			// The live subscription is established before replay so no event can be
			// lost during a long history read. Persisted events published in that
			// overlap are therefore present both in replay and in the buffered live
			// channel; discard only those fixed-watermark duplicates. Sequence-zero
			// frames were never persisted and must always remain live-deliverable.
			if event.SessionID == sessionID && event.Sequence > 0 && event.Sequence <= replayWatermark {
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

	// Only sequenced (persisted) events carry an SSE id; the client uses it as the
	// resume cursor (?after=). Control frames and non-persisted streaming deltas
	// have Sequence 0 and must not emit an id, or a reconnect would rewind to a
	// non-numeric cursor and replay the entire history.
	if event.Sequence > 0 {
		fmt.Fprintf(writer, "id: %d\n", event.Sequence)
	}
	fmt.Fprintf(writer, "event: %s\n", event.Type)
	fmt.Fprintf(writer, "data: %s\n\n", body)
}
