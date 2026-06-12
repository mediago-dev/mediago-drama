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

// HandleListBackends lists configured ACP-compatible agent backends.
func (handler AgentBackends) HandleListBackends(context *gin.Context) {
	httpresponse.OK(context, handler.store.ListBackends())
}
