package chat

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

type AgentChatStateResponse = agent.AgentChatStateResponse
type AgentChatAppendRequest = agent.AgentChatAppendRequest
type AgentChatMessageRecord = agent.AgentChatMessageRecord
type AgentChatActivityRecord = agent.AgentChatActivityRecord
type AgentConversationRecord = agent.AgentConversationRecord
type AgentEvent = agent.AgentEvent
type AgentACPEvent = agent.AgentACPEvent
type AgentACPLocation = agent.AgentACPLocation
type AgentACPContentBlock = agent.AgentACPContentBlock

type agentChatStateResponse = agent.AgentChatStateResponse
type agentChatAppendRequest = agent.AgentChatAppendRequest
type agentChatMessageRecord = agent.AgentChatMessageRecord
type agentChatActivityRecord = agent.AgentChatActivityRecord
type agentEvent = agent.AgentEvent

var (
	NormalizeAgentChatMessages        = agent.NormalizeAgentChatMessages
	NormalizeAgentChatActivity        = agent.NormalizeAgentChatActivity
	NormalizeAgentEventForPersistence = agent.NormalizeAgentEventForPersistence
	ProjectAgentEvent                 = agent.ProjectAgentEvent
	FlattenConversationMessages       = agent.FlattenConversationMessages
	FirstNonEmpty                     = shared.FirstNonEmpty
)

// ProjectEnsurer ensures project metadata exists before legacy chat writes.
type ProjectEnsurer interface {
	EnsureProjectRecord(projectID string) error
}

// Service owns agent chat/event projections.
type Service struct {
	mu            sync.RWMutex
	dir           string
	agentSessions *repository.AgentSessionRepository
	projects      ProjectEnsurer
	initErr       error
	// lastEventSequences caches the last persisted sequence per session history
	// path so appends do not rescan the whole file. Guarded by mu.
	lastEventSequences map[string]int64
	// eventReadCursors caches the byte offset after a sequence in each JSONL
	// history, so incremental reads do not rescan older events.
	eventReadCursors map[string]agentEventReadCursor
	// chatProjectionCache stores projected conversation state per session file.
	chatProjectionCache map[string]agentChatProjectionCache
	// agentEventWriters keeps one buffered JSONL writer per session history.
	agentEventWriters map[string]*agentEventWriter
}

type agentEventReadCursor struct {
	sequence int64
	offset   int64
}

type agentChatProjectionCache struct {
	state         agentChatStateResponse
	conversations map[string]AgentConversationRecord
	lastSequence  int64
	fileOffset    int64
}

// NewService returns a chat service.
func NewService(workspaceDir string, sessions *repository.AgentSessionRepository, projects ProjectEnsurer, initErr error) *Service {
	service := &Service{
		dir:                 shared.ResolveWorkspaceDir(workspaceDir),
		agentSessions:       sessions,
		projects:            projects,
		initErr:             initErr,
		lastEventSequences:  map[string]int64{},
		eventReadCursors:    map[string]agentEventReadCursor{},
		chatProjectionCache: map[string]agentChatProjectionCache{},
		agentEventWriters:   map[string]*agentEventWriter{},
	}
	return service
}

func (store *Service) agentHistoryPathFor(projectID string) (string, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return shared.WorkspacePathsFor(store.dir).AgentHistoryPath(""), nil
	}
	provider, ok := store.projects.(interface {
		ProjectDir(projectID string) (string, error)
	})
	if !ok {
		return "", fmt.Errorf("project directory provider is not configured")
	}
	projectDir, err := provider.ProjectDir(projectID)
	if err != nil {
		return "", err
	}
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return "", fmt.Errorf("project %s is not registered with projectDir", projectID)
	}
	return filepath.Join(projectDir, "agent-history.jsonl"), nil
}

func (store *Service) agentSessionHistoryPathFor(projectID string, sessionID string) (string, error) {
	sessionID = domain.CleanProjectID(sessionID)
	if sessionID == "" {
		return "", fmt.Errorf("sessionID is required")
	}
	dir, err := store.agentSessionHistoryDirFor(projectID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, sessionID+".jsonl"), nil
}

func (store *Service) agentSessionHistoryDirFor(projectID string) (string, error) {
	if domain.CleanProjectID(projectID) == "" {
		return filepath.Join(shared.WorkspacePathsFor(store.dir).GlobalMetadataDir(), "agent-sessions"), nil
	}
	provider, ok := store.projects.(interface {
		ProjectDir(projectID string) (string, error)
	})
	if !ok {
		return "", fmt.Errorf("project directory provider is not configured")
	}
	projectDir, err := provider.ProjectDir(projectID)
	if err != nil {
		return "", err
	}
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return "", fmt.Errorf("project %s is not registered with projectDir", projectID)
	}
	return filepath.Join(shared.ProjectMetadataDir(projectDir), "agent-sessions"), nil
}

func (store *Service) ensureProjectRecord(projectID string) error {
	if store.projects == nil {
		return nil
	}
	return store.projects.EnsureProjectRecord(projectID)
}
