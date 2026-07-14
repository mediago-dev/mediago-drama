package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	serviceacp "github.com/mediago-dev/mediago-drama/services/server/internal/service/acp"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

const (
	agentRuntimeAuthenticationRequiredMessage = "Agent 尚未完成认证，请前往设置配置对应凭据后重试"
	agentRuntimeUnavailableMessage            = "Agent 运行环境暂不可用，请检查运行配置后重试"
)

var errAgentRuntimeConfigInspectorUnavailable = errors.New("agent runtime config inspector is unavailable")

// AgentRuntimeConfigInspector probes agent runtime configuration.
type AgentRuntimeConfigInspector func(ctx context.Context, projectID string) (service.AgentRuntimeConfigResponse, error)

// AgentRuntime handles runtime configuration HTTP routes.
type AgentRuntime struct {
	inspect AgentRuntimeConfigInspector
}

// NewAgentRuntime returns an agent runtime route handler.
func NewAgentRuntime(inspect AgentRuntimeConfigInspector) AgentRuntime {
	return AgentRuntime{inspect: inspect}
}

// HandleAgentRuntimeConfig godoc
// @Summary 获取 Agent 运行配置
// @Description 返回当前项目可用于 Agent 运行的配置检查结果。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/runtime-config [get]
func (handler AgentRuntime) HandleAgentRuntimeConfig(context *gin.Context) {
	if handler.inspect == nil {
		httpresponse.Fail(
			context,
			http.StatusServiceUnavailable,
			agentRuntimeUnavailableMessage,
			errAgentRuntimeConfigInspectorUnavailable,
		)
		return
	}
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	config, err := handler.inspect(context.Request.Context(), projectID)
	if err != nil {
		publicMessage := agentRuntimeUnavailableMessage
		if serviceacp.IsAuthenticationRequiredError(err) {
			publicMessage = agentRuntimeAuthenticationRequiredMessage
		}
		httpresponse.Fail(context, http.StatusServiceUnavailable, publicMessage, err)
		return
	}
	httpresponse.OK(context, config)
}
