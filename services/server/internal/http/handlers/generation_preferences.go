package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	generationservice "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

// GenerationPreferenceService supplies generation preference operations.
type GenerationPreferenceService interface {
	GetGenerationPreference(scopeID string) (dto.GenerationPreferenceRecord, error)
	UpdateGenerationPreference(request dto.UpdateGenerationPreferenceRequest) (dto.GenerationPreferenceRecord, error)
}

// GenerationPreferences handles generation preference HTTP routes.
type GenerationPreferences struct {
	service GenerationPreferenceService
}

// NewGenerationPreferences returns a generation preference route handler.
func NewGenerationPreferences(service GenerationPreferenceService) GenerationPreferences {
	return GenerationPreferences{service: service}
}

// HandleGenerationPreferences godoc
// @Summary 获取生成偏好
// @Description 返回指定生成会话的模型和参数偏好。
// @Tags Generation
// @Produce json
// @Param sessionId path string true "Session ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/preferences [get]
func (handler GenerationPreferences) HandleGenerationPreferences(context *gin.Context) {
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}

	preferences, err := handler.service.GetGenerationPreference(generationservice.GenerationScopeIDForSessionID(sessionID))
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, preferences)
}

// HandlePutGenerationPreferences godoc
// @Summary 保存生成偏好
// @Description 更新指定生成会话的模型和参数偏好。
// @Tags Generation
// @Accept json
// @Produce json
// @Param sessionId path string true "Session ID"
// @Param payload body SwaggerObject true "Generation preference payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/generation/sessions/{sessionId}/preferences [put]
func (handler GenerationPreferences) HandlePutGenerationPreferences(context *gin.Context) {
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}
	payload, err := decodeJSON[dto.UpdateGenerationPreferenceRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	payload.ScopeID = generationservice.GenerationScopeIDForSessionID(sessionID)

	preferences, err := handler.service.UpdateGenerationPreference(payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, preferences)
}
