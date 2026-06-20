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

// HandleAgentRuntimeConfig returns runtime configuration if the runner supports it.
func (handler AgentRuntime) HandleAgentRuntimeConfig(context *gin.Context) {
	if handler.inspect == nil {
		httpresponse.OK(context, service.AgentRuntimeConfigResponse{Options: []service.AgentRuntimeSelectConfig{}})
		return
	}
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	config, err := handler.inspect(context.Request.Context(), projectID)
	if err != nil {
		slog.Warn("agent runtime config probe failed", "error", err)
		httpresponse.OK(context, service.AgentRuntimeConfigResponse{Options: []service.AgentRuntimeSelectConfig{}})
		return
	}
	httpresponse.OK(context, config)
}
