package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
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

// JianyingDraftSettingsRequest updates local Jianying draft export settings.
type JianyingDraftSettingsRequest struct {
	DraftsRoot string `json:"draftsRoot"`
}

// HandleAPIKeys godoc
// @Summary 获取 API Key 配置
// @Description 返回模型供应商 API Key 的配置和脱敏状态。
// @Tags Settings
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/api-keys [get]
func (handler Settings) HandleAPIKeys(context *gin.Context) {
	list, err := handler.service.ListAPIKeys(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, list)
}

// HandleModelPlatforms godoc
// @Summary 获取聚合平台配置
// @Description 返回当前打包版本开放展示的聚合平台。
// @Tags Settings
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/settings/model-platforms [get]
func (handler Settings) HandleModelPlatforms(context *gin.Context) {
	httpresponse.OK(context, handler.service.ListModelPlatforms(context.Request.Context()))
}

// HandleJianyingDraftSettings godoc
// @Summary 获取剪映草稿设置
// @Description 返回本机剪映草稿文件夹位置。
// @Tags Settings
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/jianying-draft [get]
func (handler Settings) HandleJianyingDraftSettings(context *gin.Context) {
	settings, err := handler.service.GetJianyingDraftSettings(context.Request.Context())
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandlePutJianyingDraftSettings godoc
// @Summary 保存剪映草稿设置
// @Description 保存本机剪映草稿文件夹位置。
// @Tags Settings
// @Accept json
// @Produce json
// @Param payload body JianyingDraftSettingsRequest true "Jianying draft settings"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/jianying-draft [put]
func (handler Settings) HandlePutJianyingDraftSettings(context *gin.Context) {
	payload, err := decodeJSON[JianyingDraftSettingsRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	settings, err := handler.service.SetJianyingDraftSettings(
		context.Request.Context(),
		service.JianyingDraftSettings{DraftsRoot: payload.DraftsRoot},
	)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandlePutAPIKey godoc
// @Summary 保存 API Key
// @Description 保存指定供应商的 API Key。
// @Tags Settings
// @Accept json
// @Produce json
// @Param provider path string true "Provider ID"
// @Param payload body APIKeyUpdateRequest true "API key payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/api-keys/{provider} [put]
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

// HandleDeleteAPIKey godoc
// @Summary 删除 API Key
// @Description 删除指定供应商保存的 API Key。
// @Tags Settings
// @Produce json
// @Param provider path string true "Provider ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/api-keys/{provider} [delete]
func (handler Settings) HandleDeleteAPIKey(context *gin.Context) {
	list, err := handler.service.ClearAPIKey(context.Request.Context(), context.Param("provider"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePostProviderLogin godoc
// @Summary 发起供应商登录
// @Description 发起需要交互授权的供应商登录流程。
// @Tags Settings
// @Accept json
// @Produce json
// @Param provider path string true "Provider ID"
// @Param payload body ProviderLoginStartRequest false "Login start payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/api-keys/{provider}/login [post]
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
	case "libtv":
		result, err := handler.service.BeginLibTVLogin(context.Request.Context(), payload.Force)
		if err != nil {
			writeSettingsError(context, err)
			return
		}
		httpresponse.OK(context, result)
	default:
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, service.ErrAPIKeyProviderNotFound)
	}
}

// HandlePostProviderLoginCheck godoc
// @Summary 检查供应商登录
// @Description 使用设备码或挑战码完成供应商登录检查。
// @Tags Settings
// @Accept json
// @Produce json
// @Param provider path string true "Provider ID"
// @Param payload body ProviderLoginCheckRequest true "Login check payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/api-keys/{provider}/login/check [post]
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

// HandleAgentModelProfiles godoc
// @Summary 获取 Agent 模型配置
// @Description 返回全局 Agent 模型 Profile 列表。
// @Tags Settings
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles [get]
func (handler Settings) HandleAgentModelProfiles(context *gin.Context) {
	list, err := handler.service.ListAgentModelProfiles(context.Request.Context())
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePostAgentModelProfile godoc
// @Summary 创建 Agent 模型配置
// @Description 创建一个全局 Agent 模型 Profile。
// @Tags Settings
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Agent model profile payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles [post]
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

// HandlePatchAgentModelProfile godoc
// @Summary 更新 Agent 模型配置
// @Description 更新一个全局 Agent 模型 Profile。
// @Tags Settings
// @Accept json
// @Produce json
// @Param profileId path string true "Profile ID"
// @Param payload body SwaggerObject true "Agent model profile patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles/{profileId} [patch]
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

// HandleDeleteAgentModelProfile godoc
// @Summary 删除 Agent 模型配置
// @Description 删除一个全局 Agent 模型 Profile。
// @Tags Settings
// @Produce json
// @Param profileId path string true "Profile ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles/{profileId} [delete]
func (handler Settings) HandleDeleteAgentModelProfile(context *gin.Context) {
	list, err := handler.service.DeleteAgentModelProfile(context.Request.Context(), context.Param("profileId"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePutAgentModelProfileDefault godoc
// @Summary 设置默认 Agent 模型配置
// @Description 将指定 Agent 模型 Profile 设为默认配置。
// @Tags Settings
// @Produce json
// @Param profileId path string true "Profile ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles/{profileId}/default [put]
func (handler Settings) HandlePutAgentModelProfileDefault(context *gin.Context) {
	list, err := handler.service.SetAgentModelProfileDefault(context.Request.Context(), context.Param("profileId"))
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, list)
}

// HandlePutAgentModelProfileAPIKey godoc
// @Summary 保存 Agent 模型配置 API Key
// @Description 为指定 Agent 模型 Profile 保存 API Key。
// @Tags Settings
// @Accept json
// @Produce json
// @Param profileId path string true "Profile ID"
// @Param payload body APIKeyUpdateRequest true "API key payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles/{profileId}/api-key [put]
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

// HandleDeleteAgentModelProfileAPIKey godoc
// @Summary 删除 Agent 模型配置 API Key
// @Description 删除指定 Agent 模型 Profile 保存的 API Key。
// @Tags Settings
// @Produce json
// @Param profileId path string true "Profile ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/agent-model-profiles/{profileId}/api-key [delete]
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
	case errors.Is(err, service.ErrAppSettingStoreMissing):
		httpresponse.ErrorFromStatus(context, http.StatusServiceUnavailable, err)
	case errors.Is(err, service.ErrJianyingDraftInvalid):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
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
