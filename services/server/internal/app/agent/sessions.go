package agent

import (
	"github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

// SessionService tracks agent sessions.
type SessionService = serviceagent.SessionService

// Run is an agent run record.
type Run = serviceagent.AgentRun

// RunStartOptions controls how a run starts.
type RunStartOptions = serviceagent.AgentRunStartOptions

// RunFinishResult describes a finished agent run.
type RunFinishResult = serviceagent.AgentRunFinishResult

// NewSessionService creates a session service backed by the workspace DB when available.
func NewSessionService(workspaceStores ...*workspace.WorkspaceStateService) *SessionService {
	if len(workspaceStores) > 0 && workspaceStores[0] != nil && workspaceStores[0].InitErr() == nil {
		return serviceagent.NewSessionService(workspaceStores[0].AgentSessionRepository())
	}
	return serviceagent.NewSessionService(nil)
}
