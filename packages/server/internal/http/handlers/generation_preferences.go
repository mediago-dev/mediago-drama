package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/http/dto"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	generationservice "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/generation"
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

// HandleGenerationPreferences returns preferences for one scope.
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

// HandlePutGenerationPreferences updates preferences for one scope.
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
