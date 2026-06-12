package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/http/dto"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/generation"
)

// GenerationTaskService supplies generation task operations.
type GenerationTaskService interface {
	ListGenerationModels() dto.GenerationModelsResponse
	CreateGenerationMessage(ctx context.Context, payload dto.GenerationMessageRequest) (dto.GenerationMessageResponse, int, error)
	StreamGenerationText(ctx context.Context, payload dto.GenerationMessageRequest, emit func(dto.GenerationTextStreamEvent) error) (int, error)
	CreateGenerationConversation(payload dto.CreateGenerationConversationRequest) (dto.GenerationConversationRecord, int, error)
	DeleteGenerationConversation(id string) (bool, error)
	GetGenerationVideo(ctx context.Context, id string) (dto.GenerationMessageResponse, int, error)
	RetryGenerationTask(ctx context.Context, id string) (dto.GenerationMessageResponse, int, error)
	ListGenerationConversations(scopeID string, kind string) (dto.GenerationConversationsResponse, error)
	ListGenerationTasks(query service.GenerationTaskListQuery) (dto.GenerationTasksResponse, error)
	GetGenerationTask(id string) (dto.GenerationTaskRecord, bool, error)
	DeleteGenerationTask(id string) (dto.GenerationTasksResponse, bool, error)
	ListGenerationNotifications(projectID string) (dto.GenerationNotificationsResponse, error)
	MarkGenerationNotificationRead(id string) (dto.GenerationNotificationRecord, bool, error)
	MarkAllGenerationNotificationsRead(projectID string) error
	SubscribeGenerationNotifications() (<-chan dto.GenerationNotificationEvent, func())
	GenerationNotificationConnectedEvent(projectID string) dto.GenerationNotificationEvent
}

// GenerationTasks handles generation task HTTP routes.
type GenerationTasks struct {
	service GenerationTaskService
}

// NewGenerationTasks returns a generation task route handler.
func NewGenerationTasks(service GenerationTaskService) GenerationTasks {
	return GenerationTasks{service: service}
}

// HandleGenerationModels lists available generation models and routes.
func (handler GenerationTasks) HandleGenerationModels(context *gin.Context) {
	httpresponse.OK(context, handler.service.ListGenerationModels())
}

// HandleGenerationMessage creates a generation request.
func (handler GenerationTasks) HandleGenerationMessage(context *gin.Context) {
	payload, err := decodeJSON[dto.GenerationMessageRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if sessionID := pathParam(context, "sessionId"); sessionID != "" {
		payload.ConversationID = sessionID
	}

	response, status, err := handler.service.CreateGenerationMessage(context.Request.Context(), payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGenerationTextStream streams a text generation request using SSE.
func (handler GenerationTasks) HandleGenerationTextStream(context *gin.Context) {
	payload, err := decodeJSON[dto.GenerationMessageRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if sessionID := pathParam(context, "sessionId"); sessionID != "" {
		payload.ConversationID = sessionID
	}

	flusher, ok := context.Writer.(http.Flusher)
	if !ok {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}

	context.Header("Content-Type", "text/event-stream")
	context.Header("Cache-Control", "no-cache")
	context.Header("Connection", "keep-alive")
	context.Status(http.StatusOK)

	emit := func(event dto.GenerationTextStreamEvent) error {
		writeGenerationTextSSE(context.Writer, event)
		flusher.Flush()
		return nil
	}

	status, err := handler.service.StreamGenerationText(context.Request.Context(), payload, emit)
	if err != nil {
		if status == 0 {
			status = http.StatusInternalServerError
		}
		writeGenerationTextSSE(context.Writer, dto.GenerationTextStreamEvent{
			Type:   "error",
			Status: "failed",
			Error:  httpresponse.PublicErrorMessage(status, err),
		})
		flusher.Flush()
		return
	}
}

// HandleGenerationConversations lists generation conversations.
func (handler GenerationTasks) HandleGenerationConversations(context *gin.Context) {
	conversations, err := handler.service.ListGenerationConversations(
		"",
		strings.TrimSpace(context.Query("kind")),
	)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, conversations)
}

// HandleCreateGenerationConversation creates a generation conversation.
func (handler GenerationTasks) HandleCreateGenerationConversation(context *gin.Context) {
	payload, err := decodeJSON[dto.CreateGenerationConversationRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	payload.ScopeID = service.GenerationScopeIDForSessionID(payload.ID)

	conversation, status, err := handler.service.CreateGenerationConversation(payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, conversation)
}

// HandleDeleteGenerationConversation deletes one generation conversation.
func (handler GenerationTasks) HandleDeleteGenerationConversation(context *gin.Context) {
	id, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}

	deleted, err := handler.service.DeleteGenerationConversation(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "generation session not found")
		return
	}

	httpresponse.OK(context, map[string]bool{"deleted": true})
}

// HandleGenerationVideo polls one generation video task.
func (handler GenerationTasks) HandleGenerationVideo(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	response, status, err := handler.service.GetGenerationVideo(context.Request.Context(), id)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleRetryGenerationTask retries one generation task.
func (handler GenerationTasks) HandleRetryGenerationTask(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	response, status, err := handler.service.RetryGenerationTask(context.Request.Context(), id)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGenerationTasks lists generation tasks.
func (handler GenerationTasks) HandleGenerationTasks(context *gin.Context) {
	sessionID := pathParam(context, "sessionId")
	if sessionID == "" {
		sessionID = strings.TrimSpace(context.Query("sessionId"))
	}
	limit, ok := nonNegativeIntQuery(context, "limit")
	if !ok {
		return
	}
	offset, ok := nonNegativeIntQuery(context, "offset")
	if !ok {
		return
	}
	tasks, err := handler.service.ListGenerationTasks(service.GenerationTaskListQuery{
		ConversationID: sessionID,
		Kind:           strings.TrimSpace(context.Query("kind")),
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, tasks)
}

func nonNegativeIntQuery(context *gin.Context, name string) (int, bool) {
	value := strings.TrimSpace(context.Query(name))
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		httpresponse.Error(context, http.StatusBadRequest, name+" must be a non-negative number")
		return 0, false
	}
	return parsed, true
}

func writeGenerationTextSSE(writer http.ResponseWriter, event dto.GenerationTextStreamEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}
	eventType := strings.TrimSpace(event.Type)
	if eventType == "" {
		eventType = "message"
	}
	fmt.Fprintf(writer, "event: %s\n", eventType)
	fmt.Fprintf(writer, "data: %s\n\n", body)
}

// HandleGenerationNotifications lists completed generation notifications.
func (handler GenerationTasks) HandleGenerationNotifications(context *gin.Context) {
	notifications, err := handler.service.ListGenerationNotifications(optionalProjectID(context))
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, notifications)
}

// HandleGenerationNotificationEvents streams live generation notification events using SSE.
func (handler GenerationTasks) HandleGenerationNotificationEvents(context *gin.Context) {
	projectID := optionalProjectID(context)
	flusher, ok := context.Writer.(http.Flusher)
	if !ok {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}

	context.Header("Cache-Control", "no-cache")
	context.Header("Connection", "keep-alive")
	context.Header("Content-Type", "text/event-stream")
	context.Status(http.StatusOK)

	events, unsubscribe := handler.service.SubscribeGenerationNotifications()
	defer unsubscribe()

	writeGenerationNotificationSSE(context.Writer, handler.service.GenerationNotificationConnectedEvent(projectID))
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
		case event, ok := <-events:
			if !ok {
				return
			}
			if projectID != "" && event.ProjectID != "" && event.ProjectID != projectID {
				continue
			}
			heartbeat.Reset(sseHeartbeatInterval)
			writeGenerationNotificationSSE(context.Writer, event)
			flusher.Flush()
		}
	}
}

// HandleMarkGenerationNotificationRead marks one notification read.
func (handler GenerationTasks) HandleMarkGenerationNotificationRead(context *gin.Context) {
	id, ok := requiredPathParam(context, "notificationId", "notificationId")
	if !ok {
		return
	}

	notification, ok, err := handler.service.MarkGenerationNotificationRead(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "generation notification not found")
		return
	}

	httpresponse.OK(context, notification)
}

// HandleMarkAllGenerationNotificationsRead marks all notifications read.
func (handler GenerationTasks) HandleMarkAllGenerationNotificationsRead(context *gin.Context) {
	if err := handler.service.MarkAllGenerationNotificationsRead(optionalProjectID(context)); err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, map[string]bool{"ok": true})
}

func writeGenerationNotificationSSE(writer http.ResponseWriter, event dto.GenerationNotificationEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}
	eventType := strings.TrimSpace(event.Type)
	if eventType == "" {
		eventType = "message"
	}
	if strings.TrimSpace(event.ID) != "" {
		fmt.Fprintf(writer, "id: %s\n", event.ID)
	}
	fmt.Fprintf(writer, "event: %s\n", eventType)
	fmt.Fprintf(writer, "data: %s\n\n", body)
}

// HandleGenerationTask returns one generation task.
func (handler GenerationTasks) HandleGenerationTask(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	task, ok, err := handler.service.GetGenerationTask(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "generation task not found")
		return
	}

	httpresponse.OK(context, task)
}

// HandleDeleteGenerationTask deletes one generation task.
func (handler GenerationTasks) HandleDeleteGenerationTask(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	tasks, deleted, err := handler.service.DeleteGenerationTask(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "generation task not found")
		return
	}

	httpresponse.OK(context, tasks)
}
