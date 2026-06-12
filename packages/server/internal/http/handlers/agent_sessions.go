package handlers

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
)

// SessionService supplies agent session operations.
type SessionService interface {
	Create(sessionID string, projectID string)
	ProjectSessionID(projectID string) (string, bool)
	List(projectID string) []service.AgentSessionSummary
	Status(sessionID string) service.AgentSessionStatus
	CancelRun(sessionID string) (service.AgentSessionStatus, bool)
}

// AgentSessions handles agent session HTTP routes.
type AgentSessions struct {
	store       SessionService
	newID       func(prefix string) (string, error)
	onCancelled func(service.AgentSessionStatus)
	statusFn    func(sessionID string) service.AgentSessionStatus
}

// NewAgentSessions returns an agent session route handler.
func NewAgentSessions(
	store SessionService,
	newID func(prefix string) (string, error),
	onCancelled func(service.AgentSessionStatus),
	statusFns ...func(sessionID string) service.AgentSessionStatus,
) AgentSessions {
	handler := AgentSessions{store: store, newID: newID, onCancelled: onCancelled}
	if len(statusFns) > 0 {
		handler.statusFn = statusFns[0]
	}
	return handler
}

// HandleCreateSession creates or reuses an agent session.
func (handler AgentSessions) HandleCreateSession(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeOptionalJSON[service.AgentSessionRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	rawProjectID := payload.ProjectID
	payload.ProjectID = projectID
	slog.Debug(
		"agent session create requested",
		"raw_project_id", domain.DiagnosticProjectID(rawProjectID),
		"project_id", domain.DiagnosticProjectID(payload.ProjectID),
	)

	if payload.ProjectID != "" && !payload.NewSession {
		if sessionID, ok := handler.store.ProjectSessionID(payload.ProjectID); ok {
			slog.Debug(
				"agent session reused",
				"session_id", sessionID,
				"project_id", domain.DiagnosticProjectID(payload.ProjectID),
			)
			httpresponse.OK(context, service.AgentSessionResponse{SessionID: sessionID})
			return
		}
	}

	sessionID, err := handler.newSessionID()
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	handler.store.Create(sessionID, payload.ProjectID)
	slog.Debug(
		"agent session created",
		"session_id", sessionID,
		"project_id", domain.DiagnosticProjectID(payload.ProjectID),
	)
	httpresponse.OK(context, service.AgentSessionResponse{SessionID: sessionID})
}

// HandleListAgentSessions lists agent sessions.
func (handler AgentSessions) HandleListAgentSessions(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	httpresponse.OK(context, service.AgentSessionsResponse{
		Sessions: handler.store.List(projectID),
	})
}

// HandleAgentSessionStatus returns session status.
func (handler AgentSessions) HandleAgentSessionStatus(context *gin.Context) {
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}

	status := handler.status(sessionID)
	slog.Debug(
		"agent session status",
		"session_id", status.SessionID,
		"running", status.Running,
		"last_status", status.LastStatus,
		"pending_permissions", len(status.PendingPermissions),
	)
	httpresponse.OK(context, status)
}

// HandleCancelAgentSession cancels an active session run.
func (handler AgentSessions) HandleCancelAgentSession(context *gin.Context) {
	sessionID, ok := requiredPathParam(context, "sessionId", "sessionId")
	if !ok {
		return
	}

	status, cancelled := handler.store.CancelRun(sessionID)
	if handler.statusFn != nil {
		status = handler.statusFn(sessionID)
	}
	if cancelled && handler.onCancelled != nil {
		handler.onCancelled(status)
	}
	httpresponse.OK(context, status)
}

func (handler AgentSessions) status(sessionID string) service.AgentSessionStatus {
	if handler.statusFn != nil {
		return handler.statusFn(sessionID)
	}
	return handler.store.Status(sessionID)
}

func (handler AgentSessions) newSessionID() (string, error) {
	if handler.newID == nil {
		return "", nil
	}
	return handler.newID("session")
}
