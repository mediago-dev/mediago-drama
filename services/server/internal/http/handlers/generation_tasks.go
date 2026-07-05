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
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

// GenerationTaskService supplies generation task operations.
type GenerationTaskService interface {
	ListGenerationModels() dto.GenerationModelsResponse
	CreateGenerationMessage(ctx context.Context, payload dto.GenerationMessageRequest) (dto.GenerationMessageResponse, int, error)
	CreatePromptOptimizedGenerationMessage(ctx context.Context, payload dto.GenerationMessageRequest) (dto.GenerationOptimizeAndGenerateResponse, int, error)
	PreviewGenerationVoice(ctx context.Context, payload dto.GenerationVoicePreviewRequest) (dto.GenerationVoicePreviewResponse, int, error)
	GenerationVoicePreviewContent(routeID string, voiceID string) (dto.GenerationVoicePreviewAsset, []byte, bool, error)
	ImportGenerationMediaAssets(payload dto.ImportGenerationMediaAssetsRequest) (dto.GenerationTasksResponse, int, error)
	StreamGenerationText(ctx context.Context, payload dto.GenerationMessageRequest, emit func(dto.GenerationTextStreamEvent) error) (int, error)
	CreateGenerationConversation(payload dto.CreateGenerationConversationRequest) (dto.GenerationConversationRecord, int, error)
	DeleteGenerationConversation(id string) (bool, error)
	GetGenerationVideo(ctx context.Context, id string) (dto.GenerationMessageResponse, int, error)
	RetryGenerationTask(ctx context.Context, id string) (dto.GenerationMessageResponse, int, error)
	ListGenerationConversations(scopeID string, kind string) (dto.GenerationConversationsResponse, error)
	ListGenerationTasks(query service.GenerationTaskListQuery) (dto.GenerationTasksResponse, error)
	ListSelectedGenerationAssets(projectID string, query service.SelectedGenerationAssetQuery) (dto.SelectedGenerationAssetsResponse, error)
	ListStoryboardVideoResources(projectID string) (dto.StoryboardVideoResourcesResponse, error)
	UpdateSelectedGenerationAsset(projectID string, payload dto.UpdateSelectedGenerationAssetRequest) (dto.UpdateSelectedGenerationAssetResponse, int, error)
	DeleteSelectedGenerationAsset(projectID string, id string) (bool, error)
	GetGenerationTask(id string) (dto.GenerationTaskRecord, bool, error)
	UpdateGenerationTaskAsset(id string, assetIndex int, patch dto.UpdateGenerationTaskAssetRequest) (dto.GenerationTaskRecord, bool, error)
	DeleteGenerationTaskAsset(id string, assetIndex int) (dto.GenerationTaskRecord, bool, error)
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

// HandleGenerationModels godoc
// @Summary 获取生成模型目录
// @Description 返回可用生成模型、路由、参数和供应商配置状态。
// @Tags Generation
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/models [get]
func (handler GenerationTasks) HandleGenerationModels(context *gin.Context) {
	httpresponse.OK(context, handler.service.ListGenerationModels())
}

// HandleGenerationMessage godoc
// @Summary 提交生成消息
// @Description 向生成会话提交文本、图片或视频生成请求。
// @Tags Generation
// @Accept json
// @Produce json
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Generation message payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/messages [post]
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

// HandlePromptOptimizedGenerationMessage godoc
// @Summary 优化提示词并提交生成
// @Description 先通过文本路由优化当前 prompt，再用优化后的 prompt 提交媒体生成，并记录两段生成历史。
// @Tags Generation
// @Accept json
// @Produce json
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Prompt optimized generation payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/messages/optimize-and-generate [post]
func (handler GenerationTasks) HandlePromptOptimizedGenerationMessage(context *gin.Context) {
	payload, err := decodeJSON[dto.GenerationMessageRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if sessionID := pathParam(context, "sessionId"); sessionID != "" {
		payload.ConversationID = sessionID
	}

	response, status, err := handler.service.CreatePromptOptimizedGenerationMessage(context.Request.Context(), payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGenerationVoicePreview godoc
// @Summary 生成音色试听
// @Description 为音频生成路由和音色生成短试听，不写入生成历史。
// @Tags Generation
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Voice preview payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/generation/voice-preview [post]
func (handler GenerationTasks) HandleGenerationVoicePreview(context *gin.Context) {
	payload, err := decodeJSON[dto.GenerationVoicePreviewRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	response, status, err := handler.service.PreviewGenerationVoice(context.Request.Context(), payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGenerationVoicePreviewContent godoc
// @Summary 获取内置音色试听音频
// @Description 返回应用内置的本地音色试听文件。
// @Tags Generation
// @Produce audio/mpeg
// @Param routeId path string true "Route ID"
// @Param voiceId path string true "Voice ID"
// @Success 200 {file} file
// @Failure 404 {object} SwaggerEnvelope
// @Router /api/v1/generation/voice-previews/{routeId}/{voiceId} [get]
func (handler GenerationTasks) HandleGenerationVoicePreviewContent(context *gin.Context) {
	routeID, ok := requiredPathParam(context, "routeId", "routeId")
	if !ok {
		return
	}
	voiceID, ok := requiredPathParam(context, "voiceId", "voiceId")
	if !ok {
		return
	}

	asset, data, found, err := handler.service.GenerationVoicePreviewContent(routeID, voiceID)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, err)
		return
	}
	if !found {
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, fmt.Errorf("voice preview not found"))
		return
	}
	mimeType := strings.TrimSpace(asset.MIMEType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	context.Header("Cache-Control", "public, max-age=31536000, immutable")
	context.Data(http.StatusOK, mimeType, data)
}

// HandleImportGenerationMediaAssets godoc
// @Summary 导入生成媒体资产
// @Description 将媒体资产导入到生成会话上下文。
// @Tags Generation
// @Accept json
// @Produce json
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Media asset import payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/media-assets/import [post]
func (handler GenerationTasks) HandleImportGenerationMediaAssets(context *gin.Context) {
	payload, err := decodeJSON[dto.ImportGenerationMediaAssetsRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if sessionID := pathParam(context, "sessionId"); sessionID != "" {
		payload.ConversationID = sessionID
	}

	response, status, err := handler.service.ImportGenerationMediaAssets(payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGenerationTextStream godoc
// @Summary 流式生成文本
// @Description 向生成会话提交文本生成请求并通过 SSE 返回流式事件。
// @Tags Generation
// @Accept json
// @Produce text/event-stream
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Generation stream payload"
// @Success 200 {string} string "SSE stream"
// @Failure 400 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/messages/stream [post]
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

// HandleGenerationConversations godoc
// @Summary 获取生成会话列表
// @Description 返回生成工作台中的会话列表。
// @Tags Generation
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions [get]
func (handler GenerationTasks) HandleGenerationConversations(context *gin.Context) {
	conversations, err := handler.service.ListGenerationConversations(
		strings.TrimSpace(context.Query("scopeId")),
		strings.TrimSpace(context.Query("kind")),
	)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, conversations)
}

// HandleCreateGenerationConversation godoc
// @Summary 创建生成会话
// @Description 创建一个新的生成会话。
// @Tags Generation
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Generation session payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions [post]
func (handler GenerationTasks) HandleCreateGenerationConversation(context *gin.Context) {
	payload, err := decodeJSON[dto.CreateGenerationConversationRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(payload.ScopeID) == "" {
		payload.ScopeID = service.GenerationScopeIDForSessionID(payload.ID)
	}

	conversation, status, err := handler.service.CreateGenerationConversation(payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, conversation)
}

// HandleDeleteGenerationConversation godoc
// @Summary 删除生成会话
// @Description 删除一个生成会话及其关联状态。
// @Tags Generation
// @Produce json
// @Param sessionId path string true "Session ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId} [delete]
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

// HandleGenerationVideo godoc
// @Summary 获取生成任务结果
// @Description 返回视频任务结果或生成任务产物。
// @Tags Generation
// @Produce application/octet-stream
// @Param taskId path string true "Task ID"
// @Success 200 {file} file
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId}/result [get]
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

// HandleRetryGenerationTask godoc
// @Summary 重试生成任务
// @Description 对失败或可重试的生成任务重新提交请求。
// @Tags Generation
// @Produce json
// @Param taskId path string true "Task ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId}/retry [post]
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

// HandleGenerationTasks godoc
// @Summary 获取生成任务列表
// @Description 返回所有生成任务，可按会话、状态或类型筛选。
// @Tags Generation
// @Produce json
// @Param sessionId query string false "Session ID"
// @Param status query string false "Task status"
// @Param kind query string false "Generation kind"
// @Param projectId query string false "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks [get]
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
		ProjectID:      strings.TrimSpace(context.Query("projectId")),
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, tasks)
}

// HandleGenerationSessionTasks godoc
// @Summary 获取会话生成任务
// @Description 返回指定生成会话下的任务列表。
// @Tags Generation
// @Produce json
// @Param sessionId path string true "Session ID"
// @Param status query string false "Task status"
// @Param kind query string false "Generation kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/tasks [get]
func (handler GenerationTasks) HandleGenerationSessionTasks(context *gin.Context) {
	handler.HandleGenerationTasks(context)
}

// HandleSelectedGenerationAssets godoc
// @Summary 获取项目选中生成资产
// @Description 返回项目页面中被选中用于展示或编排的生成资产。
// @Tags Generation
// @Produce json
// @Param projectId path string true "Project ID"
// @Param resourceType query string false "Resource type"
// @Param resourceId query string false "Resource section/resource ID"
// @Param sourceDocumentId query string false "Source document ID"
// @Param documentId query string false "Alias of sourceDocumentId"
// @Param sectionId query string false "Alias of resourceId"
// @Param kind query string false "Asset kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/selected-assets [get]
func (handler GenerationTasks) HandleSelectedGenerationAssets(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}

	assets, err := handler.service.ListSelectedGenerationAssets(
		projectID,
		service.SelectedGenerationAssetQuery{
			Kind:             strings.TrimSpace(context.Query("kind")),
			ResourceID:       firstNonEmptyParam(context.Query("resourceId"), context.Query("sectionId")),
			ResourceType:     strings.TrimSpace(context.Query("resourceType")),
			SourceDocumentID: firstNonEmptyParam(context.Query("sourceDocumentId"), context.Query("documentId")),
		},
	)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, assets)
}

// HandleStoryboardVideoResources godoc
// @Summary 获取项目分镜组成片资源
// @Description 按分镜文档和分镜组汇总当前项目中的视频成片资源。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/storyboard-video-resources [get]
func (handler GenerationTasks) HandleStoryboardVideoResources(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}

	resources, err := handler.service.ListStoryboardVideoResources(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, resources)
}

// HandleUpdateSelectedGenerationAsset godoc
// @Summary 更新项目选中资产
// @Description 将图片等素材选入或取消选入项目资源概览。
// @Tags Generation
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Selected asset payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/selected-assets [post]
func (handler GenerationTasks) HandleUpdateSelectedGenerationAsset(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[dto.UpdateSelectedGenerationAssetRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	response, status, err := handler.service.UpdateSelectedGenerationAsset(projectID, payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleDeleteSelectedGenerationAsset godoc
// @Summary 取消项目选中资产
// @Description 按已选资源 ID 取消选入项目资源概览。
// @Tags Generation
// @Produce json
// @Param projectId path string true "Project ID"
// @Param selectedAssetId path string true "Selected asset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/selected-assets/{selectedAssetId} [delete]
func (handler GenerationTasks) HandleDeleteSelectedGenerationAsset(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	id, ok := requiredPathParam(context, "selectedAssetId", "selectedAssetId")
	if !ok {
		return
	}

	deleted, err := handler.service.DeleteSelectedGenerationAsset(projectID, id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "selected asset not found")
		return
	}
	httpresponse.OK(context, map[string]bool{"deleted": true})
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

// HandleGenerationNotifications godoc
// @Summary 获取生成通知
// @Description 返回生成任务通知列表。
// @Tags Generation Notifications
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/notifications [get]
func (handler GenerationTasks) HandleGenerationNotifications(context *gin.Context) {
	notifications, err := handler.service.ListGenerationNotifications(optionalProjectID(context))
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, notifications)
}

// HandleProjectGenerationNotifications godoc
// @Summary 获取生成通知
// @Description 返回生成任务通知列表。
// @Tags Generation Notifications
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/notifications [get]
func (handler GenerationTasks) HandleProjectGenerationNotifications(context *gin.Context) {
	handler.HandleGenerationNotifications(context)
}

// HandleGenerationNotificationEvents godoc
// @Summary 订阅生成通知事件
// @Description 使用 SSE 订阅生成通知更新事件。
// @Tags Generation Notifications
// @Produce text/event-stream
// @Success 200 {string} string "SSE stream"
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/notifications/events [get]
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

// HandleProjectGenerationNotificationEvents godoc
// @Summary 订阅生成通知事件
// @Description 使用 SSE 订阅生成通知更新事件。
// @Tags Generation Notifications
// @Produce text/event-stream
// @Param projectId path string true "Project ID"
// @Success 200 {string} string "SSE stream"
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/notifications/events [get]
func (handler GenerationTasks) HandleProjectGenerationNotificationEvents(context *gin.Context) {
	handler.HandleGenerationNotificationEvents(context)
}

// HandleMarkGenerationNotificationRead godoc
// @Summary 标记单条生成通知已读
// @Description 将指定生成通知标记为已读。
// @Tags Generation Notifications
// @Produce json
// @Param notificationId path string true "Notification ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/notifications/{notificationId}/read [patch]
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

// HandleMarkAllGenerationNotificationsRead godoc
// @Summary 标记所有生成通知已读
// @Description 将当前范围内所有生成通知标记为已读。
// @Tags Generation Notifications
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/notifications/read [patch]
func (handler GenerationTasks) HandleMarkAllGenerationNotificationsRead(context *gin.Context) {
	if err := handler.service.MarkAllGenerationNotificationsRead(optionalProjectID(context)); err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, map[string]bool{"ok": true})
}

// HandleMarkAllProjectGenerationNotificationsRead godoc
// @Summary 标记所有生成通知已读
// @Description 将当前范围内所有生成通知标记为已读。
// @Tags Generation Notifications
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/generation/notifications/read [patch]
func (handler GenerationTasks) HandleMarkAllProjectGenerationNotificationsRead(context *gin.Context) {
	handler.HandleMarkAllGenerationNotificationsRead(context)
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

// HandleGenerationTask godoc
// @Summary 获取生成任务详情
// @Description 返回一个生成任务的完整状态、结果和尝试记录。
// @Tags Generation
// @Produce json
// @Param taskId path string true "Task ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId} [get]
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

// HandleUpdateGenerationTaskAsset godoc
// @Summary 更新生成任务资产
// @Description 更新生成任务中某个结果资产的元数据。
// @Tags Generation
// @Accept json
// @Produce json
// @Param taskId path string true "Task ID"
// @Param assetIndex path int true "Asset index"
// @Param payload body SwaggerObject true "Generation task asset patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId}/assets/{assetIndex} [patch]
func (handler GenerationTasks) HandleUpdateGenerationTaskAsset(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	rawIndex, ok := requiredPathParam(context, "assetIndex", "assetIndex")
	if !ok {
		return
	}
	assetIndex, err := strconv.Atoi(rawIndex)
	if err != nil || assetIndex < 0 {
		httpresponse.Error(context, http.StatusBadRequest, "assetIndex must be a non-negative number")
		return
	}

	payload, err := decodeJSON[dto.UpdateGenerationTaskAssetRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if payload.Selected == nil && payload.Title == nil && strings.TrimSpace(payload.ResourceType) == "" {
		httpresponse.Error(context, http.StatusBadRequest, "selected, title, or resourceType is required")
		return
	}

	task, updated, err := handler.service.UpdateGenerationTaskAsset(id, assetIndex, payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !updated {
		httpresponse.Error(context, http.StatusNotFound, "generation task asset not found")
		return
	}

	httpresponse.OK(context, task)
}

// HandleDeleteGenerationTaskAsset godoc
// @Summary 删除生成任务资产
// @Description 删除生成任务中的某个结果资产。
// @Tags Generation
// @Produce json
// @Param taskId path string true "Task ID"
// @Param assetIndex path int true "Asset index"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId}/assets/{assetIndex} [delete]
func (handler GenerationTasks) HandleDeleteGenerationTaskAsset(context *gin.Context) {
	id, ok := requiredPathParam(context, "taskId", "taskId")
	if !ok {
		return
	}

	rawIndex, ok := requiredPathParam(context, "assetIndex", "assetIndex")
	if !ok {
		return
	}
	assetIndex, err := strconv.Atoi(rawIndex)
	if err != nil || assetIndex < 0 {
		httpresponse.Error(context, http.StatusBadRequest, "assetIndex must be a non-negative number")
		return
	}

	task, deleted, err := handler.service.DeleteGenerationTaskAsset(id, assetIndex)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "generation task asset not found")
		return
	}

	httpresponse.OK(context, task)
}

// HandleDeleteGenerationTask godoc
// @Summary 删除生成任务
// @Description 删除一个生成任务记录。
// @Tags Generation
// @Produce json
// @Param taskId path string true "Task ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/tasks/{taskId} [delete]
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
