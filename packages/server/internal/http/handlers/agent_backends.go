package handlers

import (
	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	serviceagent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
)

// AgentBackends handles configured ACP backend routes.
type AgentBackends struct {
	store *serviceagent.AgentBackendService
}

// NewAgentBackends returns an agent backend route handler.
func NewAgentBackends(store *serviceagent.AgentBackendService) AgentBackends {
	return AgentBackends{store: store}
}

// HandleListBackends godoc
// @Summary 获取 Agent 后端
// @Description 返回当前可用的 ACP 兼容 Agent 后端及激活状态。
// @Tags Agent
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/agent/backends [get]
func (handler AgentBackends) HandleListBackends(context *gin.Context) {
	httpresponse.OK(context, handler.store.ListBackends())
}
