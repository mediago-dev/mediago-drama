package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/settings"
)

// Settings handles settings HTTP routes.
type Settings struct {
	service *service.Settings
}

// NewSettings returns a settings route handler.
func NewSettings(service *service.Settings) Settings {
	return Settings{service: service}
}

// APIKeyUpdateRequest updates a provider API key.
type APIKeyUpdateRequest struct {
	APIKey string `json:"apiKey"`
}

// ProviderLoginStartRequest starts a provider login flow.
type ProviderLoginStartRequest struct {
	Force bool `json:"force"`
}

// ProviderLoginCheckRequest checks a provider login challenge.
type ProviderLoginCheckRequest struct {
	DeviceCode string `json:"deviceCode"`
}

// HandleAPIKeys lists API key provider configuration state.
func (handler Settings) HandleAPIKeys(context *gin.Context) {
	list, err := handler.service.ListAPIKeys(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePutAPIKey stores a provider API key.
func (handler Settings) HandlePutAPIKey(context *gin.Context) {
	payload, err := decodeJSON[APIKeyUpdateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	list, err := handler.service.SetAPIKey(context.Request.Context(), context.Param("provider"), payload.APIKey)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandleDeleteAPIKey removes a provider API key.
func (handler Settings) HandleDeleteAPIKey(context *gin.Context) {
	list, err := handler.service.ClearAPIKey(context.Request.Context(), context.Param("provider"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePostProviderLogin starts a provider-specific login flow.
func (handler Settings) HandlePostProviderLogin(context *gin.Context) {
	payload, err := decodeOptionalJSON[ProviderLoginStartRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	switch context.Param("provider") {
	case "jimeng":
		result, err := handler.service.BeginJimengLogin(context.Request.Context(), payload.Force)
		if err != nil {
			writeSettingsError(context, err)
			return
		}
		httpresponse.OK(context, result)
	default:
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, service.ErrAPIKeyProviderNotFound)
	}
}

// HandlePostProviderLoginCheck checks a provider-specific login flow.
func (handler Settings) HandlePostProviderLoginCheck(context *gin.Context) {
	payload, err := decodeJSON[ProviderLoginCheckRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	switch context.Param("provider") {
	case "jimeng":
		result, err := handler.service.CompleteJimengLogin(context.Request.Context(), payload.DeviceCode)
		if err != nil {
			writeSettingsError(context, err)
			return
		}
		httpresponse.OK(context, result)
	default:
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, service.ErrAPIKeyProviderNotFound)
	}
}

// HandleAgentModelProfiles lists global agent model profiles.
func (handler Settings) HandleAgentModelProfiles(context *gin.Context) {
	list, err := handler.service.ListAgentModelProfiles(context.Request.Context())
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePostAgentModelProfile creates a global agent model profile.
func (handler Settings) HandlePostAgentModelProfile(context *gin.Context) {
	payload, err := decodeJSON[service.AgentModelProfileMutation](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	list, err := handler.service.CreateAgentModelProfile(context.Request.Context(), payload)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePatchAgentModelProfile updates a global agent model profile.
func (handler Settings) HandlePatchAgentModelProfile(context *gin.Context) {
	payload, err := decodeJSON[service.AgentModelProfileMutation](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	list, err := handler.service.UpdateAgentModelProfile(context.Request.Context(), context.Param("profileId"), payload)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandleDeleteAgentModelProfile removes a global agent model profile.
func (handler Settings) HandleDeleteAgentModelProfile(context *gin.Context) {
	list, err := handler.service.DeleteAgentModelProfile(context.Request.Context(), context.Param("profileId"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePutAgentModelProfileDefault selects the default global agent model profile.
func (handler Settings) HandlePutAgentModelProfileDefault(context *gin.Context) {
	list, err := handler.service.SetAgentModelProfileDefault(context.Request.Context(), context.Param("profileId"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePutAgentModelProfileAPIKey stores a global agent model profile API key.
func (handler Settings) HandlePutAgentModelProfileAPIKey(context *gin.Context) {
	payload, err := decodeJSON[APIKeyUpdateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	list, err := handler.service.SetAgentModelProfileAPIKey(context.Request.Context(), context.Param("profileId"), payload.APIKey)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandleDeleteAgentModelProfileAPIKey removes a global agent model profile API key.
func (handler Settings) HandleDeleteAgentModelProfileAPIKey(context *gin.Context) {
	list, err := handler.service.ClearAgentModelProfileAPIKey(context.Request.Context(), context.Param("profileId"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

func writeSettingsError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAPIKeyProviderNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	case errors.Is(err, service.ErrAPIKeyRequired):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrProviderLoginRequired):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrAgentModelNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	case errors.Is(err, service.ErrAgentModelInvalid):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrAgentModelConflict):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, service.ErrAgentModelStoreMissing):
		httpresponse.ErrorFromStatus(context, http.StatusServiceUnavailable, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}

func decodeJSON[TRequest any](context *gin.Context) (TRequest, error) {
	var payload TRequest
	decoder := json.NewDecoder(context.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return payload, fmt.Errorf("invalid json body: %w", err)
	}

	return payload, nil
}

func decodeOptionalJSON[TRequest any](context *gin.Context) (TRequest, error) {
	var payload TRequest
	if context.Request.Body == nil || context.Request.ContentLength == 0 {
		return payload, nil
	}

	decoder := json.NewDecoder(context.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil && err != io.EOF {
		return payload, fmt.Errorf("invalid json body: %w", err)
	}

	return payload, nil
}
