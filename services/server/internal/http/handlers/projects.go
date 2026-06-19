package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
)

// ProjectBriefStore persists project brief state.
type ProjectBriefStore interface {
	LoadProjectBrief(projectID string) (service.ProjectBrief, error)
	SaveProjectBrief(projectID string, brief service.ProjectBrief, mask service.ProjectBriefUpdateMask) (service.ProjectBrief, error)
}

// ProjectBriefs handles project brief HTTP routes.
type ProjectBriefs struct {
	store   ProjectBriefStore
	publish func(projectID string, brief service.ProjectBrief)
}

// NewProjectBriefs returns a project brief route handler.
func NewProjectBriefs(store ProjectBriefStore, publish func(projectID string, brief service.ProjectBrief)) ProjectBriefs {
	return ProjectBriefs{store: store, publish: publish}
}

// HandleGetProjectBrief godoc
// @Summary 获取项目创作简报
// @Description 返回项目的创作目标、世界观、受众和生产偏好等简报信息。
// @Tags Project Config
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/brief [get]
func (handler ProjectBriefs) HandleGetProjectBrief(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	brief, err := handler.store.LoadProjectBrief(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, brief)
}

// HandlePutProjectBrief godoc
// @Summary 更新项目创作简报
// @Description 保存项目创作简报并发布简报更新事件。
// @Tags Project Config
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Project brief patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/brief [put]
func (handler ProjectBriefs) HandlePutProjectBrief(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.ProjectBriefPatch](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	update, mask := service.ProjectBriefPatchToUpdate(payload)
	brief, err := handler.store.SaveProjectBrief(projectID, update, mask)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !mask.Empty() && handler.publish != nil {
		handler.publish(projectID, brief)
	}
	httpresponse.OK(context, brief)
}
