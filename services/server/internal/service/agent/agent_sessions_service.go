package agent

import (
	"context"
	"sort"
	"strings"
	"sync"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

// SessionService tracks active agent runs and persists session state.
type SessionService struct {
	mu       sync.Mutex
	repo     *repository.AgentSessionRepository
	sessions map[string]*agentSession
}

type agentSession struct {
	projectID     string
	title         string
	ACPSessionID  string
	runs          map[string]*AgentRun
	lastRootRunID string
	lastStatus    string
	lastMessage   string
}

type AgentRun struct {
	RunID        string
	ACPSessionID string
	Cancel       context.CancelFunc
	Status       string
	Message      string
	AgentTag     string
}

type AgentRunStartOptions struct {
	AgentTag string
}

type AgentRunFinishResult struct {
	Status   AgentSessionStatus
	Terminal bool
}

// NewSessionService returns an agent session service backed by the given repository.
func NewSessionService(repo *repository.AgentSessionRepository) *SessionService {
	store := &SessionService{
		sessions: map[string]*agentSession{},
	}
	if repo != nil {
		store.repo = repo
		store.reconcileInterruptedRuns()
	}
	return store
}

func (store *SessionService) create(sessionID string, projectID string) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if _, ok := store.sessions[sessionID]; ok {
		return
	}
	if session, ok := store.loadSessionUnlocked(sessionID); ok {
		store.sessions[sessionID] = session
		return
	}
	store.sessions[sessionID] = &agentSession{
		projectID: strings.TrimSpace(projectID),
		runs:      map[string]*AgentRun{},
	}
	store.persistSessionUnlocked(sessionID, store.sessions[sessionID])
}

// Create creates an agent session for HTTP handlers.
func (store *SessionService) Create(sessionID string, projectID string) {
	store.create(sessionID, projectID)
}

func (store *SessionService) projectSessionID(projectID string) (string, bool) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return "", false
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	if store.repo != nil {
		model, err := store.repo.FindLatestAgentSessionByProject(projectID)
		if err == nil && strings.TrimSpace(model.SessionID) != "" {
			if session, ok := store.loadSessionUnlocked(model.SessionID); ok {
				store.sessions[model.SessionID] = session
			}
			return model.SessionID, true
		}
		if err != nil && !repository.IsRecordNotFound(err) {
			return "", false
		}
	}

	ids := []string{}
	for sessionID, session := range store.sessions {
		if session != nil && strings.TrimSpace(session.projectID) == projectID {
			ids = append(ids, sessionID)
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return "", false
	}
	return ids[len(ids)-1], true
}

// ProjectSessionID returns the latest session for a project.
func (store *SessionService) ProjectSessionID(projectID string) (string, bool) {
	return store.projectSessionID(projectID)
}

func (store *SessionService) list(projectID string) []AgentSessionSummary {
	projectID = strings.TrimSpace(projectID)

	store.mu.Lock()
	defer store.mu.Unlock()

	if store.repo != nil {
		if models, err := store.repo.ListAgentSessions(projectID); err == nil {
			return store.sessionSummariesFromModelsUnlocked(models)
		}
	}

	summaries := []AgentSessionSummary{}
	for sessionID, session := range store.sessions {
		if session == nil {
			continue
		}
		if projectID != "" && strings.TrimSpace(session.projectID) != projectID {
			continue
		}
		summaries = append(summaries, AgentSessionSummary{
			SessionID:   sessionID,
			ProjectID:   strings.TrimSpace(session.projectID),
			Title:       strings.TrimSpace(session.title),
			LastStatus:  strings.TrimSpace(session.lastStatus),
			LastMessage: strings.TrimSpace(session.lastMessage),
			Running:     session.hasActiveRuns(),
		})
	}
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].SessionID > summaries[j].SessionID
	})
	return summaries
}

// List returns agent sessions for HTTP handlers.
func (store *SessionService) List(projectID string) []AgentSessionSummary {
	return store.list(projectID)
}

func (store *SessionService) sessionSummariesFromModelsUnlocked(models []agentSessionModel) []AgentSessionSummary {
	if len(models) == 0 {
		return []AgentSessionSummary{}
	}
	summaries := make([]AgentSessionSummary, 0, len(models))
	for _, model := range models {
		sessionID := strings.TrimSpace(model.SessionID)
		if sessionID == "" {
			continue
		}
		lastStatus := strings.TrimSpace(model.LastStatus)
		summaries = append(summaries, AgentSessionSummary{
			SessionID:   sessionID,
			ProjectID:   strings.TrimSpace(model.ProjectID),
			Title:       strings.TrimSpace(model.Title),
			LastStatus:  lastStatus,
			LastMessage: strings.TrimSpace(model.LastMessage),
			UpdatedAt:   domain.StringFromTime(model.UpdatedAt),
			Running:     lastStatus != "" && !isTerminalRunStatus(lastStatus),
		})
		if session, ok := store.loadSessionUnlocked(sessionID); ok {
			store.sessions[sessionID] = session
		}
	}
	return summaries
}

// NeedsTitle reports whether a session can accept an auto-generated title.
func (store *SessionService) NeedsTitle(sessionID string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessionUnlocked(sessionID)
	return ok && strings.TrimSpace(session.title) == ""
}

// SetTitleIfEmpty stores a generated title when the session has no title yet.
func (store *SessionService) SetTitleIfEmpty(sessionID string, title string) bool {
	title = strings.TrimSpace(title)
	if title == "" {
		return false
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessionUnlocked(sessionID)
	if !ok || strings.TrimSpace(session.title) != "" {
		return false
	}
	session.title = title
	store.persistSessionUnlocked(sessionID, session)
	return true
}

func (store *SessionService) sessionUnlocked(sessionID string) (*agentSession, bool) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, false
	}
	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok || session == nil {
		return nil, false
	}
	return session, true
}

// StartRun starts an agent run.
func (store *SessionService) StartRun(
	sessionID string,
	projectID string,
	RunID string,
	Cancel context.CancelFunc,
	options AgentRunStartOptions,
) (string, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if _, ok := store.sessions[sessionID]; !ok {
		if session, loaded := store.loadSessionUnlocked(sessionID); loaded {
			store.sessions[sessionID] = session
		}
	}
	session, ok := store.sessions[sessionID]
	if !ok || session.projectID != strings.TrimSpace(projectID) {
		return "", false
	}

	if session.hasActiveRuns() {
		return session.ACPSessionID, false
	}
	session.lastRootRunID = RunID
	session.lastStatus = "running"
	session.lastMessage = "Agent 运行中。"
	run := &AgentRun{
		RunID:    RunID,
		Cancel:   Cancel,
		Status:   "running",
		Message:  "Agent 运行中。",
		AgentTag: strings.TrimSpace(options.AgentTag),
	}
	session.runs[RunID] = run
	store.persistSessionUnlocked(sessionID, session)
	store.persistRunUnlocked(sessionID, run, false)
	return session.ACPSessionID, true
}

// Run returns a copy of a run.
func (store *SessionService) Run(sessionID string, RunID string) (*AgentRun, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return nil, false
	}
	run, ok := session.runs[RunID]
	if !ok {
		return nil, false
	}
	copyRun := *run
	return &copyRun, true
}

func (store *SessionService) cancelRun(sessionID string) (AgentSessionStatus, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok || !session.hasActiveRuns() {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok || !session.hasActiveRuns() {
		return store.statusUnlocked(sessionID), false
	}

	for _, run := range session.runs {
		if isTerminalRunStatus(run.Status) {
			continue
		}
		if run.Cancel != nil {
			run.Cancel()
		}
		run.Status = "cancelled"
		run.Message = "Agent 运行已中断。"
		store.persistRunUnlocked(sessionID, run, true)
	}
	session.lastStatus = "cancelled"
	session.lastMessage = "Agent 运行已中断。"
	store.persistSessionUnlocked(sessionID, session)
	return store.statusFromSession(sessionID, session), true
}

// CancelRun cancels an active run for HTTP handlers.
func (store *SessionService) CancelRun(sessionID string) (AgentSessionStatus, bool) {
	return store.cancelRun(sessionID)
}

// FinishRun marks a run as finished and releases completed parents.
func (store *SessionService) FinishRun(sessionID string, RunID string, Status string, Message string) AgentRunFinishResult {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return AgentRunFinishResult{Status: AgentSessionStatus{SessionID: sessionID}, Terminal: true}
	}
	run, ok := session.runs[RunID]
	if !ok {
		return AgentRunFinishResult{Status: store.statusFromSession(sessionID, session), Terminal: true}
	}
	if isTerminalRunStatus(run.Status) {
		return AgentRunFinishResult{Status: store.statusFromRun(sessionID, run), Terminal: true}
	}

	run.Cancel = nil
	run.Message = Message
	run.Status = normalizeRunStatus(Status)
	if run.ACPSessionID != "" {
		session.ACPSessionID = run.ACPSessionID
	}
	session.lastStatus = run.Status
	session.lastMessage = Message
	store.persistRunUnlocked(sessionID, run, true)
	store.persistSessionUnlocked(sessionID, session)

	return AgentRunFinishResult{
		Status:   store.statusFromRun(sessionID, run),
		Terminal: true,
	}
}

// SetACPSessionID records the ACP session ID for a run.
func (store *SessionService) SetACPSessionID(sessionID string, RunID string, ACPSessionID string) {
	if ACPSessionID == "" {
		return
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return
	}
	run, ok := session.runs[RunID]
	if !ok {
		return
	}
	run.ACPSessionID = ACPSessionID
	session.ACPSessionID = ACPSessionID
	store.persistSessionUnlocked(sessionID, session)
	store.persistRunUnlocked(sessionID, run, false)
}

// ClearACPSessionID clears the reusable ACP session ID.
func (store *SessionService) ClearACPSessionID(sessionID string) {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return
	}
	session.ACPSessionID = ""
	store.persistSessionUnlocked(sessionID, session)
}

func (store *SessionService) Status(sessionID string) AgentSessionStatus {
	store.mu.Lock()
	defer store.mu.Unlock()

	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return AgentSessionStatus{SessionID: sessionID}
	}

	return store.statusFromSession(sessionID, session)
}

func (store *SessionService) statusUnlocked(sessionID string) AgentSessionStatus {
	session, ok := store.sessions[sessionID]
	if !ok {
		if loaded, loadedOK := store.loadSessionUnlocked(sessionID); loadedOK {
			store.sessions[sessionID] = loaded
			session = loaded
			ok = true
		}
	}
	if !ok {
		return AgentSessionStatus{SessionID: sessionID}
	}

	return store.statusFromSession(sessionID, session)
}

func (store *SessionService) statusFromSession(
	sessionID string,
	session *agentSession,
) AgentSessionStatus {
	RunID := session.lastRootRunID
	if RunID == "" {
		for id := range session.runs {
			RunID = id
			break
		}
	}
	if RunID != "" {
		if run := session.runs[RunID]; run != nil {
			Status := store.statusFromRun(sessionID, run)
			Status.Running = session.hasActiveRuns()
			if session.lastStatus != "" {
				Status.LastStatus = session.lastStatus
				Status.LastMessage = session.lastMessage
			}
			return Status
		}
	}
	return AgentSessionStatus{
		SessionID:   sessionID,
		Running:     session.hasActiveRuns(),
		LastStatus:  session.lastStatus,
		LastMessage: session.lastMessage,
	}
}

func (store *SessionService) statusFromRun(sessionID string, run *AgentRun) AgentSessionStatus {
	if run == nil {
		return AgentSessionStatus{SessionID: sessionID}
	}
	return AgentSessionStatus{
		SessionID:   sessionID,
		Running:     !isTerminalRunStatus(run.Status),
		LastStatus:  run.Status,
		LastMessage: run.Message,
	}
}

// CountActiveRuns reports how many agent runs across all sessions are not terminal.
// Consumed by the runtime activity probe that gates hot-update application.
func (store *SessionService) CountActiveRuns() int {
	store.mu.Lock()
	defer store.mu.Unlock()
	count := 0
	for _, session := range store.sessions {
		for _, run := range session.runs {
			if !isTerminalRunStatus(run.Status) {
				count++
			}
		}
	}
	return count
}

func (session *agentSession) hasActiveRuns() bool {
	for _, run := range session.runs {
		if !isTerminalRunStatus(run.Status) {
			return true
		}
	}
	return false
}

func normalizeRunStatus(Status string) string {
	Status = strings.TrimSpace(Status)
	switch Status {
	case "completed", "failed", "cancelled", "interrupted", "paused", "waiting", "running":
		return Status
	case "":
		return "completed"
	default:
		return Status
	}
}

// NormalizeRunStatus normalizes run status values.
func NormalizeRunStatus(Status string) string {
	return normalizeRunStatus(Status)
}

func isTerminalRunStatus(Status string) bool {
	switch Status {
	case "completed", "failed", "cancelled", "finished", "interrupted", "paused":
		return true
	default:
		return false
	}
}

// IsTerminalRunStatus reports whether an agent run status is terminal.
func IsTerminalRunStatus(Status string) bool {
	return isTerminalRunStatus(Status)
}
