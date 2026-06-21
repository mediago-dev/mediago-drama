package chat

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

const (
	agentEventDeltaFlushInterval      = 100 * time.Millisecond
	agentEventBufferedWriterSize      = 64 * 1024
	agentSessionIndexThrottleInterval = 2 * time.Second
)

func (store *Service) loadAgentChat(projectID string, sessionIDs ...string) (agentChatStateResponse, error) {
	if store.initErr != nil {
		return agentChatStateResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	sessionID := ""
	if len(sessionIDs) > 0 {
		sessionID = strings.TrimSpace(sessionIDs[0])
	}
	return store.loadAgentChatUnlocked(projectID, sessionID)
}

// LoadAgentChat returns chat state for HTTP handlers.
func (store *Service) LoadAgentChat(projectID string, sessionID string) (agentChatStateResponse, error) {
	return store.loadAgentChat(projectID, sessionID)
}

func (store *Service) appendAgentMessages(projectID string, request agentChatAppendRequest) (agentChatStateResponse, error) {
	if store.initErr != nil {
		return agentChatStateResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(FirstNonEmpty(projectID, request.ProjectID))
	messages := NormalizeAgentChatMessages(request.Messages)
	if projectID != "" {
		if err := store.ensureProjectRecord(projectID); err != nil {
			return agentChatStateResponse{}, err
		}
	}
	path, err := store.agentHistoryPathFor(projectID)
	if err != nil {
		return agentChatStateResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return agentChatStateResponse{}, fmt.Errorf("creating agent chat history directory: %w", err)
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return agentChatStateResponse{}, fmt.Errorf("opening agent chat history for append: %w", err)
	}

	for _, message := range messages {
		line, err := json.Marshal(message)
		if err != nil {
			_ = file.Close()
			return agentChatStateResponse{}, fmt.Errorf("encoding agent chat message %s: %w", message.ID, err)
		}
		if _, err := file.Write(append(line, '\n')); err != nil {
			_ = file.Close()
			return agentChatStateResponse{}, fmt.Errorf("appending agent chat message %s: %w", message.ID, err)
		}
	}
	if err := file.Close(); err != nil {
		return agentChatStateResponse{}, fmt.Errorf("closing agent chat history: %w", err)
	}

	return store.loadAgentChatUnlocked(projectID, "")
}

// AppendAgentMessages appends chat messages for HTTP handlers.
func (store *Service) AppendAgentMessages(projectID string, request agentChatAppendRequest) (agentChatStateResponse, error) {
	return store.appendAgentMessages(projectID, request)
}

func (store *Service) clearAgentChat(projectID string) (agentChatStateResponse, error) {
	if store.initErr != nil {
		return agentChatStateResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	if projectID != "" {
		if err := store.ensureProjectRecord(projectID); err != nil {
			return agentChatStateResponse{}, err
		}
	}
	path, err := store.agentHistoryPathFor(projectID)
	if err != nil {
		return agentChatStateResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return agentChatStateResponse{}, fmt.Errorf("creating agent chat history directory: %w", err)
	}
	if err := os.WriteFile(path, []byte{}, 0o644); err != nil {
		return agentChatStateResponse{}, fmt.Errorf("clearing agent chat history: %w", err)
	}
	if sessionsDir, err := store.agentSessionHistoryDirFor(projectID); err == nil {
		if err := store.closeAgentEventWritersWithPrefixLocked(sessionsDir + string(filepath.Separator)); err != nil {
			return agentChatStateResponse{}, err
		}
		if err := os.RemoveAll(sessionsDir); err != nil {
			return agentChatStateResponse{}, fmt.Errorf("clearing agent session histories: %w", err)
		}
		for path := range store.lastEventSequences {
			if strings.HasPrefix(path, sessionsDir+string(filepath.Separator)) {
				delete(store.lastEventSequences, path)
			}
		}
		for path := range store.eventReadCursors {
			if strings.HasPrefix(path, sessionsDir+string(filepath.Separator)) {
				delete(store.eventReadCursors, path)
			}
		}
		for path := range store.chatProjectionCache {
			if strings.HasPrefix(path, sessionsDir+string(filepath.Separator)) {
				delete(store.chatProjectionCache, path)
			}
		}
	}
	now := timestamp.NowRFC3339Nano()
	return agentChatStateResponse{
		ProjectID: projectID,
		Messages:  []agentChatMessageRecord{},
		Activity:  []agentChatActivityRecord{},
		UpdatedAt: now,
	}, nil
}

// ClearAgentChat clears chat state for HTTP handlers.
func (store *Service) ClearAgentChat(projectID string) (agentChatStateResponse, error) {
	return store.clearAgentChat(projectID)
}

func (store *Service) loadAgentChatUnlocked(projectID string, sessionID string) (agentChatStateResponse, error) {
	projectID = domain.CleanProjectID(projectID)
	sessionID = strings.TrimSpace(sessionID)
	if state, ok, err := store.loadAgentChatFromEventsUnlocked(projectID, sessionID); err != nil {
		return agentChatStateResponse{}, err
	} else if ok {
		return state, nil
	}
	if sessionID != "" {
		return agentChatStateResponse{
			ProjectID: projectID,
			SessionID: sessionID,
			Messages:  []agentChatMessageRecord{},
			Activity:  []agentChatActivityRecord{},
		}, nil
	}

	path, err := store.agentHistoryPathFor(projectID)
	if err != nil {
		return agentChatStateResponse{
			ProjectID: projectID,
			Messages:  []agentChatMessageRecord{},
			Activity:  []agentChatActivityRecord{},
		}, nil
	}
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return agentChatStateResponse{
			ProjectID: projectID,
			Messages:  []agentChatMessageRecord{},
			Activity:  []agentChatActivityRecord{},
		}, nil
	}
	if err != nil {
		return agentChatStateResponse{}, fmt.Errorf("opening agent chat history: %w", err)
	}
	defer file.Close()

	messages := []agentChatMessageRecord{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var message agentChatMessageRecord
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			return agentChatStateResponse{}, fmt.Errorf(
				"decoding agent chat history line %d: %w",
				lineNumber,
				err,
			)
		}
		messages = append(messages, message)
	}
	if err := scanner.Err(); err != nil {
		return agentChatStateResponse{}, fmt.Errorf("reading agent chat history: %w", err)
	}

	updatedAt := ""
	if stat, err := os.Stat(path); err == nil && !stat.ModTime().IsZero() {
		updatedAt = stat.ModTime().UTC().Format(time.RFC3339Nano)
	}

	return agentChatStateResponse{
		ProjectID: projectID,
		Messages:  NormalizeAgentChatMessages(messages),
		Activity:  []agentChatActivityRecord{},
		UpdatedAt: updatedAt,
	}, nil
}

func (store *Service) appendAgentEvent(event agentEvent) (agentEvent, error) {
	if store.initErr != nil {
		return event, store.initErr
	}

	event = NormalizeAgentEventForPersistence(event)
	if strings.TrimSpace(event.SessionID) == "" {
		return event, fmt.Errorf("agent event sessionID is required")
	}
	if err := store.ensureProjectRecord(event.ProjectID); err != nil {
		return event, err
	}
	path, err := store.agentSessionHistoryPathFor(event.ProjectID, event.SessionID)
	if err != nil {
		return event, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return event, fmt.Errorf("creating agent session history directory: %w", err)
	}
	writer, err := store.agentEventWriterForPath(path)
	if err != nil {
		return event, err
	}
	return writer.append(event, store.upsertAgentSessionIndexUnlocked)
}

type agentEventWriter struct {
	mu              sync.Mutex
	path            string
	file            *os.File
	buffer          *bufio.Writer
	nextSequence    int64
	lastFlush       time.Time
	lastIndexUpsert time.Time
}

func newAgentEventWriter(path string, nextSequence int64) (*agentEventWriter, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("opening agent session history for append: %w", err)
	}
	return &agentEventWriter{
		path:         path,
		file:         file,
		buffer:       bufio.NewWriterSize(file, agentEventBufferedWriterSize),
		nextSequence: nextSequence,
	}, nil
}

func (writer *agentEventWriter) append(event agentEvent, upsertIndex func(agentEvent) error) (agentEvent, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	now := time.Now()
	if shouldUpsertAgentSessionIndex(event, writer.lastIndexUpsert, now) {
		if err := upsertIndex(event); err != nil {
			return event, err
		}
		writer.lastIndexUpsert = now
	}

	event.Sequence = writer.nextSequence
	writer.nextSequence++
	payload, err := json.Marshal(event)
	if err != nil {
		return event, fmt.Errorf("encoding agent event %s: %w", event.ID, err)
	}
	if _, err := writer.buffer.Write(append(payload, '\n')); err != nil {
		return event, fmt.Errorf("appending agent event %s: %w", event.ID, err)
	}
	if shouldFlushAgentEvent(event, writer.lastFlush, now) {
		if err := writer.flushLocked(); err != nil {
			return event, err
		}
	}
	return event, nil
}

func (writer *agentEventWriter) flush() error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.flushLocked()
}

func (writer *agentEventWriter) flushLocked() error {
	if writer.buffer == nil {
		return nil
	}
	if err := writer.buffer.Flush(); err != nil {
		return fmt.Errorf("flushing agent session history: %w", err)
	}
	writer.lastFlush = time.Now()
	return nil
}

func (writer *agentEventWriter) close() (int64, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	var result error
	if writer.buffer != nil {
		if err := writer.buffer.Flush(); err != nil {
			result = errors.Join(result, fmt.Errorf("flushing agent session history: %w", err))
		}
		writer.buffer = nil
	}
	if writer.file != nil {
		if err := writer.file.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("closing agent session history: %w", err))
		}
		writer.file = nil
	}
	return writer.nextSequence - 1, result
}

func shouldFlushAgentEvent(event agentEvent, lastFlush time.Time, now time.Time) bool {
	if !isBufferedAgentEvent(event) {
		return true
	}
	return lastFlush.IsZero() || now.Sub(lastFlush) >= agentEventDeltaFlushInterval
}

func shouldUpsertAgentSessionIndex(event agentEvent, lastUpsert time.Time, now time.Time) bool {
	if !isBufferedAgentEvent(event) {
		return true
	}
	return lastUpsert.IsZero() || now.Sub(lastUpsert) >= agentSessionIndexThrottleInterval
}

func isBufferedAgentEvent(event agentEvent) bool {
	return strings.HasSuffix(strings.TrimSpace(event.Type), ".delta")
}

func (store *Service) agentEventWriterForPath(path string) (*agentEventWriter, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if writer, ok := store.agentEventWriters[path]; ok {
		return writer, nil
	}
	nextSequence, err := store.nextAgentEventSequenceCachedUnlocked(path)
	if err != nil {
		return nil, err
	}
	writer, err := newAgentEventWriter(path, nextSequence)
	if err != nil {
		return nil, err
	}
	store.agentEventWriters[path] = writer
	return writer, nil
}

// FlushAgentEvents flushes buffered session histories without closing them.
func (store *Service) FlushAgentEvents() error {
	store.mu.RLock()
	writers := make([]*agentEventWriter, 0, len(store.agentEventWriters))
	for _, writer := range store.agentEventWriters {
		writers = append(writers, writer)
	}
	store.mu.RUnlock()

	var result error
	for _, writer := range writers {
		if err := writer.flush(); err != nil {
			result = errors.Join(result, err)
		}
	}
	return result
}

// Close flushes and closes all buffered agent event writers.
func (store *Service) Close() error {
	store.mu.Lock()
	writers := store.agentEventWriters
	store.agentEventWriters = map[string]*agentEventWriter{}
	store.mu.Unlock()

	var result error
	for path, writer := range writers {
		lastSequence, err := writer.close()
		if err != nil {
			result = errors.Join(result, err)
		}
		store.mu.Lock()
		if lastSequence > 0 {
			store.lastEventSequences[path] = lastSequence
		}
		store.mu.Unlock()
	}
	return result
}

func (store *Service) closeAgentEventWritersWithPrefixLocked(prefix string) error {
	var result error
	for path, writer := range store.agentEventWriters {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		lastSequence, err := writer.close()
		if err != nil {
			result = errors.Join(result, err)
		}
		if lastSequence > 0 {
			store.lastEventSequences[path] = lastSequence
		}
		delete(store.agentEventWriters, path)
	}
	return result
}

// nextAgentEventSequenceCachedUnlocked returns the next event sequence using the
// in-memory cache, falling back to one full history scan per session lifetime.
func (store *Service) nextAgentEventSequenceCachedUnlocked(path string) (int64, error) {
	if last, ok := store.lastEventSequences[path]; ok {
		return last + 1, nil
	}
	return store.nextAgentEventSequenceUnlocked(path)
}

func (store *Service) upsertAgentSessionIndexUnlocked(event agentEvent) error {
	if store.agentSessions == nil {
		return nil
	}
	sessionID := strings.TrimSpace(event.SessionID)
	if sessionID == "" {
		return nil
	}
	projectID := domain.CleanProjectID(event.ProjectID)
	existing, _ := store.agentSessions.GetAgentSession(sessionID)
	status := FirstNonEmpty(sessionStatusFromAgentEvent(event), existing.LastStatus)
	message := FirstNonEmpty(event.Message, existing.LastMessage)
	updatedAt := FirstNonEmpty(event.CreatedAt, domain.StringFromTime(existing.UpdatedAt), timestamp.NowRFC3339Nano())
	return store.agentSessions.UpsertAgentSession(domain.AgentSessionModel{
		SessionID:    sessionID,
		ProjectID:    FirstNonEmpty(projectID, existing.ProjectID),
		Title:        existing.Title,
		ACPSessionID: existing.ACPSessionID,
		LastStatus:   status,
		LastMessage:  message,
		UpdatedAt:    domain.TimeFromString(updatedAt),
	})
}

func sessionStatusFromAgentEvent(event agentEvent) string {
	switch strings.TrimSpace(event.Type) {
	case "agent.run.started", "agent.message.accepted":
		return "running"
	case "agent.run.completed":
		return "completed"
	case "agent.run.cancelled":
		return "cancelled"
	case "agent.run.failed":
		return "failed"
	default:
		return ""
	}
}

func (store *Service) AppendAgentEvent(event agentEvent) (agentEvent, error) {
	return store.appendAgentEvent(event)
}

func (store *Service) loadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return store.loadAgentEventsUnlocked(projectID, sessionID, afterSequence, limit)
}

func (store *Service) LoadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	return store.loadAgentEvents(projectID, sessionID, afterSequence, limit)
}

func (store *Service) loadAgentEventsUnlocked(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	projectID = domain.CleanProjectID(projectID)
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 1000
	}
	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		return nil, err
	}
	return store.loadAgentEventsFromPathUnlocked(path, afterSequence, limit)
}

func (store *Service) loadAgentEventsFromPathUnlocked(path string, afterSequence int64, limit int) ([]agentEvent, error) {
	if limit <= 0 {
		limit = 1000
	}
	if writer := store.agentEventWriters[path]; writer != nil {
		if err := writer.flush(); err != nil {
			return nil, err
		}
	}
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return []agentEvent{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("opening agent session history: %w", err)
	}
	defer file.Close()

	offset := int64(0)
	cursor, hasCursor := store.eventReadCursors[path]
	usedCursor := false
	if hasCursor && cursor.sequence <= afterSequence && cursor.offset > 0 {
		stat, err := file.Stat()
		if err == nil && stat.Size() >= cursor.offset {
			if _, err := file.Seek(cursor.offset, io.SeekStart); err != nil {
				return nil, fmt.Errorf("seeking agent session history: %w", err)
			}
			offset = cursor.offset
			usedCursor = true
		} else {
			delete(store.eventReadCursors, path)
			hasCursor = false
		}
	}

	events := []agentEvent{}
	reader := bufio.NewReader(file)
	lastSequence := int64(0)
	for {
		rawLine, readErr := reader.ReadBytes('\n')
		if len(rawLine) > 0 {
			offset += int64(len(rawLine))
		}
		line := strings.TrimSpace(string(rawLine))
		if line == "" {
			if readErr == nil {
				continue
			}
		} else {
			var event agentEvent
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				return nil, fmt.Errorf("decoding agent session history: %w", err)
			}
			if event.Sequence > lastSequence {
				lastSequence = event.Sequence
			}
			if event.Sequence > afterSequence {
				events = append(events, event)
				if len(events) >= limit {
					store.eventReadCursors[path] = agentEventReadCursor{
						sequence: event.Sequence,
						offset:   offset,
					}
					return events, nil
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			return nil, fmt.Errorf("reading agent session history: %w", readErr)
		}
	}

	if lastSequence == 0 && usedCursor {
		lastSequence = cursor.sequence
	}
	store.eventReadCursors[path] = agentEventReadCursor{
		sequence: lastSequence,
		offset:   offset,
	}
	return events, nil
}

func (store *Service) loadAgentChatFromEventsUnlocked(
	projectID string,
	sessionID string,
) (agentChatStateResponse, bool, error) {
	projectID = domain.CleanProjectID(projectID)
	sessionID = strings.TrimSpace(sessionID)
	requestedSessionID := sessionID
	if sessionID == "" {
		latestSessionID, ok, err := store.latestAgentSessionIDUnlocked(projectID)
		if err != nil || !ok {
			return agentChatStateResponse{}, false, err
		}
		sessionID = latestSessionID
	}

	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		return agentChatStateResponse{}, false, err
	}
	cached, hasCached := store.chatProjectionCache[path]
	if hasCached && !store.agentChatProjectionCacheValid(path, cached) {
		delete(store.chatProjectionCache, path)
		hasCached = false
	}
	afterSequence := int64(0)
	if hasCached {
		afterSequence = cached.lastSequence
	}

	events, err := store.loadAllAgentEventsUnlocked(projectID, sessionID, afterSequence)
	if err != nil {
		return agentChatStateResponse{}, false, err
	}
	if len(events) == 0 && !hasCached {
		if requestedSessionID != "" {
			return agentChatStateResponse{
				ProjectID: projectID,
				SessionID: sessionID,
				Messages:  []agentChatMessageRecord{},
				Activity:  []agentChatActivityRecord{},
			}, true, nil
		}
		return agentChatStateResponse{}, false, nil
	}

	nextCache := projectAgentChatProjection(projectID, sessionID, cached, hasCached, events)
	if cursor, ok := store.eventReadCursors[path]; ok {
		nextCache.fileOffset = cursor.offset
	}
	store.chatProjectionCache[path] = nextCache
	state := nextCache.state
	store.applyAgentSessionRunningStatusUnlocked(sessionID, &state)
	return state, true, nil
}

func (store *Service) agentChatProjectionCacheValid(path string, cache agentChatProjectionCache) bool {
	if cache.fileOffset <= 0 {
		return true
	}
	stat, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	if err != nil {
		return true
	}
	return stat.Size() >= cache.fileOffset
}

func (store *Service) applyAgentSessionRunningStatusUnlocked(sessionID string, state *agentChatStateResponse) {
	if store.agentSessions == nil || state == nil {
		return
	}
	session, err := store.agentSessions.GetAgentSession(sessionID)
	if err != nil {
		return
	}
	state.Running = strings.TrimSpace(session.LastStatus) != "" &&
		!isTerminalAgentSessionStatus(session.LastStatus)
}

func isTerminalAgentSessionStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "cancelled", "paused", "interrupted", "finished":
		return true
	default:
		return false
	}
}

func (store *Service) nextAgentEventSequenceUnlocked(path string) (int64, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return 1, nil
	}
	if err != nil {
		return 0, fmt.Errorf("opening agent session history for sequence: %w", err)
	}
	defer file.Close()

	var last int64
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event agentEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return 0, fmt.Errorf("decoding agent session history for sequence: %w", err)
		}
		if event.Sequence > last {
			last = event.Sequence
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("reading agent session history for sequence: %w", err)
	}
	return last + 1, nil
}

func (store *Service) loadAllAgentEventsUnlocked(projectID string, sessionID string, afterSequence int64) ([]agentEvent, error) {
	const batchSize = 1000
	events := []agentEvent{}
	for {
		batch, err := store.loadAgentEventsUnlocked(projectID, sessionID, afterSequence, batchSize)
		if err != nil {
			return nil, err
		}
		events = append(events, batch...)
		if len(batch) < batchSize {
			break
		}
		lastSequence := batch[len(batch)-1].Sequence
		if lastSequence <= afterSequence {
			break
		}
		afterSequence = lastSequence
	}
	return events, nil
}

func projectAgentChatProjection(
	projectID string,
	sessionID string,
	base agentChatProjectionCache,
	hasBase bool,
	events []agentEvent,
) agentChatProjectionCache {
	conversations := map[string]AgentConversationRecord{}
	activity := []agentChatActivityRecord{}
	lastSequence := int64(0)
	updatedAt := ""
	if hasBase {
		conversations = cloneAgentConversations(base.conversations)
		activity = append(activity, base.state.Activity...)
		lastSequence = base.lastSequence
		updatedAt = base.state.UpdatedAt
	}

	for _, event := range events {
		if event.Sequence > 0 {
			lastSequence = event.Sequence
		}
		if event.CreatedAt != "" {
			updatedAt = event.CreatedAt
		}
		ProjectAgentEvent(event, conversations, &activity)
	}

	lastEventID := ""
	if lastSequence > 0 {
		lastEventID = fmt.Sprintf("%d", lastSequence)
	} else if hasBase {
		lastEventID = base.state.LastEventID
	}
	rootMessages := FlattenConversationMessages(conversations)
	if len(rootMessages) == 0 && len(events) == 0 && hasBase {
		rootMessages = base.state.Messages
	}
	state := agentChatStateResponse{
		ProjectID:   domain.CleanProjectID(projectID),
		SessionID:   strings.TrimSpace(sessionID),
		Running:     false,
		Messages:    NormalizeAgentChatMessages(rootMessages),
		Activity:    NormalizeAgentChatActivity(activity),
		LastEventID: lastEventID,
		UpdatedAt:   updatedAt,
	}
	return agentChatProjectionCache{
		state:         state,
		conversations: conversations,
		lastSequence:  lastSequence,
	}
}

func cloneAgentConversations(src map[string]AgentConversationRecord) map[string]AgentConversationRecord {
	if len(src) == 0 {
		return map[string]AgentConversationRecord{}
	}
	dst := make(map[string]AgentConversationRecord, len(src))
	for runID, conversation := range src {
		conversation.Messages = append([]agentChatMessageRecord{}, conversation.Messages...)
		conversation.Children = append([]string{}, conversation.Children...)
		dst[runID] = conversation
	}
	return dst
}

func projectAgentChatState(
	projectID string,
	sessionID string,
	base agentChatStateResponse,
	events []agentEvent,
	lastSequence int64,
) (agentChatStateResponse, int64) {
	conversations := map[string]AgentConversationRecord{}
	activity := append([]agentChatActivityRecord{}, base.Activity...)
	lastEventID := base.LastEventID
	if lastSequence > 0 {
		lastEventID = fmt.Sprintf("%d", lastSequence)
	}
	updatedAt := base.UpdatedAt
	for _, event := range events {
		if event.Sequence > 0 {
			lastSequence = event.Sequence
			lastEventID = fmt.Sprintf("%d", event.Sequence)
		}
		if event.CreatedAt != "" {
			updatedAt = event.CreatedAt
		}
		ProjectAgentEvent(event, conversations, &activity)
	}
	rootMessages := FlattenConversationMessages(conversations)
	if len(rootMessages) == 0 && len(events) == 0 {
		rootMessages = base.Messages
	}

	return agentChatStateResponse{
		ProjectID:   domain.CleanProjectID(projectID),
		SessionID:   strings.TrimSpace(sessionID),
		Running:     false,
		Messages:    NormalizeAgentChatMessages(rootMessages),
		Activity:    NormalizeAgentChatActivity(activity),
		LastEventID: lastEventID,
		UpdatedAt:   updatedAt,
	}, lastSequence
}

func (store *Service) latestAgentSessionIDUnlocked(projectID string) (string, bool, error) {
	projectID = domain.CleanProjectID(projectID)
	if store.agentSessions == nil {
		return "", false, fmt.Errorf("agent session repository is not initialized")
	}
	session, err := store.agentSessions.FindLatestAgentSessionByProject(projectID)
	if err == nil {
		if strings.TrimSpace(session.SessionID) != "" {
			return session.SessionID, true, nil
		}
	} else if !repository.IsRecordNotFound(err) {
		return "", false, fmt.Errorf("reading latest agent session: %w", err)
	}
	return "", false, nil
}
