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

// CodexRelayAPIKeyRequest updates a Codex relay profile API key.
type CodexRelayAPIKeyRequest struct {
	APIKey string `json:"apiKey"`
}

// CodexRelayCheckRequest selects a Codex relay profile to test.
type CodexRelayCheckRequest struct {
	ProfileID string `json:"profileId"`
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

// HandleCodexRelaySettings godoc
// @Summary 获取 Codex 中转配置
// @Description 返回 Codex ACP 使用的中转配置和脱敏密钥状态。
// @Tags Settings
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/codex-relay [get]
func (handler Settings) HandleCodexRelaySettings(context *gin.Context) {
	settings, err := handler.service.GetCodexRelaySettings(context.Request.Context())
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandlePutCodexRelaySettings godoc
// @Summary 保存 Codex 中转配置
// @Description 保存 Codex ACP 使用的非密钥中转配置。
// @Tags Settings
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Codex relay settings"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/codex-relay [put]
func (handler Settings) HandlePutCodexRelaySettings(context *gin.Context) {
	payload, err := decodeJSON[service.CodexRelaySettingsMutation](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	settings, err := handler.service.SaveCodexRelaySettings(context.Request.Context(), payload)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandleCheckCodexRelaySettings godoc
// @Summary 检查 Codex 中转配置
// @Description 使用指定或当前生效的 Codex 中转配置探测上游鉴权是否可用。
// @Tags Settings
// @Accept json
// @Produce json
// @Param payload body CodexRelayCheckRequest false "Codex relay check request"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/codex-relay/check [post]
func (handler Settings) HandleCheckCodexRelaySettings(context *gin.Context) {
	payload, err := decodeOptionalJSON[CodexRelayCheckRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	result, err := handler.service.CheckCodexRelay(
		context.Request.Context(),
		service.CodexRelayCheckRequest{ProfileID: payload.ProfileID},
	)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, result)
}

// HandlePutCodexRelayProfileAPIKey godoc
// @Summary 保存 Codex 中转 API Key
// @Description 为指定 Codex 中转 Profile 保存 API Key。
// @Tags Settings
// @Accept json
// @Produce json
// @Param profileId path string true "Profile ID"
// @Param payload body CodexRelayAPIKeyRequest true "API key payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/codex-relay/profiles/{profileId}/api-key [put]
func (handler Settings) HandlePutCodexRelayProfileAPIKey(context *gin.Context) {
	payload, err := decodeJSON[CodexRelayAPIKeyRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	settings, err := handler.service.SetCodexRelayProfileAPIKey(
		context.Request.Context(),
		context.Param("profileId"),
		payload.APIKey,
	)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandleDeleteCodexRelayProfileAPIKey godoc
// @Summary 删除 Codex 中转 API Key
// @Description 删除指定 Codex 中转 Profile 保存的 API Key。
// @Tags Settings
// @Produce json
// @Param profileId path string true "Profile ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/settings/codex-relay/profiles/{profileId}/api-key [delete]
func (handler Settings) HandleDeleteCodexRelayProfileAPIKey(context *gin.Context) {
	settings, err := handler.service.ClearCodexRelayProfileAPIKey(
		context.Request.Context(),
		context.Param("profileId"),
	)
	if err != nil {
		writeSettingsError(context, err)
		return
	}

	httpresponse.OK(context, settings)
}

// HandleCodexRelayProxy godoc
// @Summary Codex 中转代理
// @Description 将 Codex ACP 发出的 Responses 兼容请求代理到当前启用的中转平台。
// @Tags Settings
// @Accept json
// @Produce json
// @Param path path string true "Relay API path"
// @Param payload body SwaggerObject false "Relay request payload"
// @Success 200 {object} SwaggerObject
// @Failure 401 {object} SwaggerObject
// @Failure 400 {object} SwaggerObject
// @Failure 502 {object} SwaggerObject
// @Router /api/v1/codex-relay/{path} [get]
// @Router /api/v1/codex-relay/{path} [post]
// @Router /api/v1/codex-relay/{path} [delete]
func (handler Settings) HandleCodexRelayProxy(context *gin.Context) {
	body, err := io.ReadAll(context.Request.Body)
	if err != nil {
		writeCodexRelayError(context, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	relayPath := context.Param("path")
	if query := context.Request.URL.RawQuery; query != "" {
		relayPath += "?" + query
	}
	upstream, err := handler.service.OpenCodexRelayRequest(
		context.Request.Context(),
		context.Request.Method,
		relayPath,
		body,
		context.Request.Header,
	)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, service.ErrCodexRelayInvalid) || errors.Is(err, service.ErrCodexRelayNotConfigured) {
			status = http.StatusBadRequest
		} else if errors.Is(err, service.ErrCodexRelayUnauthorized) {
			status = http.StatusUnauthorized
		}
		writeCodexRelayError(context, status, err)
		return
	}
	defer upstream.Body.Close()

	for _, key := range []string{"Content-Type", "Cache-Control"} {
		if value := upstream.Header.Get(key); value != "" {
			context.Header(key, value)
		}
	}
	context.Status(upstream.StatusCode)
	if _, err := io.Copy(context.Writer, upstream.Body); err != nil {
		_ = context.Error(err)
	}
}

func writeCodexRelayError(context *gin.Context, status int, err error) {
	context.JSON(status, gin.H{
		"error": gin.H{
			"message": httpresponse.PublicErrorMessage(status, err),
			"type":    "codex_relay_error",
		},
	})
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
	case errors.Is(err, service.ErrCodexRelayInvalid):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrCodexRelayNotConfigured):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrCodexRelayCheckFailed):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
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
