package handlers

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

// AgentSelectionStore supplies agent user-selection operations.
type AgentSelectionStore interface {
	ListPending(projectID string) ([]selection.Record, error)
	Decide(projectID string, selectionID string, request selection.DecisionRequest) (selection.Record, error)
	Get(projectID string, selectionID string) (selection.Record, bool, error)
}

// AgentSelections handles agent user-selection HTTP routes.
type AgentSelections struct {
	store      AgentSelectionStore
	isNotFound func(error) bool
}

// NewAgentSelections returns an agent selection route handler.
func NewAgentSelections(store AgentSelectionStore, isNotFound func(error) bool) AgentSelections {
	return AgentSelections{store: store, isNotFound: isNotFound}
}

// HandleListAgentSelections godoc
// @Summary 获取待处理选择
// @Description 返回当前项目中等待用户处理的 Agent 选择卡片。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/selections [get]
func (handler AgentSelections) HandleListAgentSelections(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	selections, err := handler.store.ListPending(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	slog.Debug(
		"agent selections listed",
		"project_id", domain.DiagnosticProjectID(projectID),
		"pending_count", len(selections),
	)
	httpresponse.OK(context, selections)
}

// HandleGetAgentSelection godoc
// @Summary 读取选择结果
// @Description 按 selectionId 读取选择卡片的最新状态与决定，用于阻塞等待超时后事后取回。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Param selectionId path string true "Selection ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/selections/{selectionId} [get]
func (handler AgentSelections) HandleGetAgentSelection(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	selectionID, ok := requiredPathParam(context, "selectionId", "selectionId")
	if !ok {
		return
	}
	record, found, err := handler.store.Get(projectID, selectionID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !found {
		httpresponse.Error(context, http.StatusNotFound, "选择请求不存在")
		return
	}
	httpresponse.OK(context, record)
}

// HandleDecideAgentSelection godoc
// @Summary 提交选择决定
// @Description 提交用户对 Agent 选择卡片的决定：optionId 选中某项、customText 自定义输入，或 cancelled 取消。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param selectionId path string true "Selection ID"
// @Param payload body SwaggerObject true "Selection decision payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/selections/{selectionId}/decision [post]
func (handler AgentSelections) HandleDecideAgentSelection(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	selectionID, ok := requiredPathParam(context, "selectionId", "selectionId")
	if !ok {
		return
	}
	payload, err := decodeJSON[selection.DecisionRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	slog.Info(
		"agent selection decision received",
		"selection_id", selectionID,
		"project_id", domain.DiagnosticProjectID(projectID),
		"has_option", payload.OptionID != "",
		"has_custom", payload.CustomText != "",
		"cancelled", payload.Cancelled,
	)
	record, err := handler.store.Decide(projectID, selectionID, payload)
	if err != nil {
		if handler.matchesNotFound(err) {
			httpresponse.Error(context, http.StatusNotFound, "选择请求不存在")
			return
		}
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	slog.Info(
		"agent selection decision applied",
		"selection_id", record.ID,
		"project_id", domain.DiagnosticProjectID(projectID),
		"status", record.Status,
	)
	httpresponse.OK(context, record)
}

func (handler AgentSelections) matchesNotFound(err error) bool {
	return handler.isNotFound != nil && handler.isNotFound(err)
}
