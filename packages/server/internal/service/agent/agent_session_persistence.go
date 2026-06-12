package agent

import (
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
)

type agentSessionModel = domain.AgentSessionModel

func (store *SessionService) reconcileInterruptedRuns() {
	if store.repo == nil {
		return
	}
	now := timestamp.NowRFC3339Nano()
	Message := "上次运行已因应用重启暂停。"
	statuses := []string{"running", "waiting"}
	_ = store.repo.ReconcileInterruptedRuns(statuses, Message, now)
}

func (store *SessionService) persistSessionUnlocked(sessionID string, session *agentSession) {
	if store.repo == nil || session == nil {
		return
	}
	now := timestamp.NowRFC3339Nano()
	model := agentSessionModel{
		SessionID:    strings.TrimSpace(sessionID),
		ProjectID:    strings.TrimSpace(session.projectID),
		Title:        strings.TrimSpace(session.title),
		ACPSessionID: strings.TrimSpace(session.ACPSessionID),
		LastStatus:   strings.TrimSpace(session.lastStatus),
		LastMessage:  strings.TrimSpace(session.lastMessage),
		UpdatedAt:    now,
	}
	_ = store.repo.UpsertAgentSession(model)
}

func (store *SessionService) persistRunUnlocked(sessionID string, run *AgentRun, finished bool) {
	_, _, _ = sessionID, run, finished
	// Run state is session-local only. Persistent history lives in the
	// session JSONL transcript, and the database stores session index/status.
}

func (store *SessionService) loadSessionUnlocked(sessionID string) (*agentSession, bool) {
	if store.repo == nil {
		return nil, false
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, false
	}
	sessionModel, err := store.repo.GetAgentSession(sessionID)
	if err != nil {
		return nil, false
	}

	session := &agentSession{
		projectID:     sessionModel.ProjectID,
		title:         sessionModel.Title,
		ACPSessionID:  sessionModel.ACPSessionID,
		runs:          map[string]*AgentRun{},
		lastStatus:    sessionModel.LastStatus,
		lastMessage:   sessionModel.LastMessage,
		lastRootRunID: "",
	}
	return session, true
}
