package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/jianyingdraft"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

// JianyingDraft handles Jianying draft export routes.
type JianyingDraft struct {
	service *service.Service
}

// NewJianyingDraft returns a Jianying draft export handler.
func NewJianyingDraft(service *service.Service) JianyingDraft {
	return JianyingDraft{service: service}
}

// HandleExportEpisodeJianyingDraft godoc
// @Summary 导出剪映草稿
// @Description 将剪辑工作台的已生成视频分镜导出为剪映桌面端草稿。
// @Tags Episodes
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject false "Jianying draft export options"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/episodes/{documentId}/jianying-draft [post]
func (handler JianyingDraft) HandleExportEpisodeJianyingDraft(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeOptionalJSON[service.ExportRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	response, err := handler.service.ExportEpisode(
		context.Request.Context(),
		projectID,
		documentID,
		payload,
	)
	if err != nil {
		writeJianyingDraftError(context, err)
		return
	}

	httpresponse.OK(context, response)
}

func writeJianyingDraftError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrDraftRootNotConfigured):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrNoExportableShots):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrUnsupportedMediaURL):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrMediaAssetInvalid):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrEpisodeNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	case errors.Is(err, service.ErrMediaAssetNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	case errors.Is(err, draftlib.ErrDraftAlreadyExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, servicesettings.ErrAppSettingStoreMissing):
		httpresponse.ErrorFromStatus(context, http.StatusServiceUnavailable, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
