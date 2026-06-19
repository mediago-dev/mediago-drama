package handlers

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
)

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
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/runtime-config [get]
func (handler AgentRuntime) HandleAgentRuntimeConfig(context *gin.Context) {
	if handler.inspect == nil {
		httpresponse.OK(context, service.AgentRuntimeConfigResponse{})
		return
	}
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	config, err := handler.inspect(context.Request.Context(), projectID)
	if err != nil {
		slog.Warn("agent runtime config probe failed", "error", err)
		httpresponse.OK(context, service.AgentRuntimeConfigResponse{})
		return
	}
	httpresponse.OK(context, config)
}
