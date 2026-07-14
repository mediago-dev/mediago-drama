package chat

import (
	"os"
	"strings"
	"testing"
)

func appendSequenceTestEvent(t *testing.T, store *Service, projectID string, sessionID string, id string) AgentEvent {
	t.Helper()
	event, err := store.AppendAgentEvent(AgentEvent{
		ID:        id,
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-sequence",
		Type:      "agent.acp",
		Message:   "思考：" + id,
	})
	if err != nil {
		t.Fatalf("AppendAgentEvent(%s) returned error: %v", id, err)
	}
	return event
}

func TestAppendAgentEventAssignsMonotonicSequences(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence"
	sessionID := "session-sequence"

	for index, id := range []string{"event-1", "event-2", "event-3"} {
		event := appendSequenceTestEvent(t, store, projectID, sessionID, id)
		if event.Sequence != int64(index+1) {
			t.Fatalf("event %s sequence = %d, want %d", id, event.Sequence, index+1)
		}
	}

	events, err := store.LoadAgentEvents(projectID, sessionID, 0, 10)
	if err != nil {
		t.Fatalf("LoadAgentEvents returned error: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("events = %d, want 3", len(events))
	}
	for index, event := range events {
		if event.Sequence != int64(index+1) {
			t.Fatalf("persisted sequence = %d, want %d", event.Sequence, index+1)
		}
	}
}

func TestAppendAgentEventDoesNotConsumeSequenceOnEncodingFailure(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-encoding-error"
	sessionID := "session-sequence-encoding-error"

	_, err := store.AppendAgentEvent(AgentEvent{
		ID:        "bad-event",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-1",
		Type:      "agent.message.delta",
		Metadata:  map[string]any{"invalid": func() {}},
	})
	if err == nil {
		t.Fatal("AppendAgentEvent returned nil error for unencodable metadata")
	}

	event, err := store.AppendAgentEvent(AgentEvent{
		ID:        "good-event",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-1",
		Type:      "agent.message.completed",
		Content:   "完成",
	})
	if err != nil {
		t.Fatalf("appending valid event: %v", err)
	}
	if event.Sequence != 1 {
		t.Fatalf("sequence = %d, want 1 after failed append", event.Sequence)
	}
}

func TestLoadAgentEventsCachesReadCursorAcrossBatches(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-cursor"
	sessionID := "session-sequence-cursor"

	for _, id := range []string{"event-1", "event-2", "event-3"} {
		appendSequenceTestEvent(t, store, projectID, sessionID, id)
	}

	firstBatch, err := store.LoadAgentEvents(projectID, sessionID, 0, 2)
	if err != nil {
		t.Fatalf("LoadAgentEvents first batch returned error: %v", err)
	}
	if len(firstBatch) != 2 || firstBatch[1].Sequence != 2 {
		t.Fatalf("first batch = %#v, want first two events", firstBatch)
	}
	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		t.Fatalf("agentSessionHistoryPathFor returned error: %v", err)
	}
	cursor, ok := store.eventReadCursors[path]
	if !ok {
		t.Fatal("expected read cursor after limited load")
	}
	if cursor.sequence != 2 || cursor.offset <= 0 {
		t.Fatalf("cursor = %#v, want sequence 2 with positive offset", cursor)
	}

	secondBatch, err := store.LoadAgentEvents(projectID, sessionID, 2, 10)
	if err != nil {
		t.Fatalf("LoadAgentEvents second batch returned error: %v", err)
	}
	if len(secondBatch) != 1 || secondBatch[0].ID != "event-3" {
		t.Fatalf("second batch = %#v, want event-3", secondBatch)
	}
}

func TestLoadAgentChatAppliesIncrementalProjectionCache(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-chat-projection-cache"
	sessionID := "session-chat-projection-cache"

	initialEvents := []AgentEvent{
		{
			ID:        "first-user",
			SessionID: sessionID,
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.user.message",
			Message:   "第一轮问题",
			CreatedAt: "2026-05-22T01:00:00Z",
		},
		{
			ID:        "first-assistant",
			SessionID: sessionID,
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.message.completed",
			Content:   "第一轮回答",
			CreatedAt: "2026-05-22T01:00:01Z",
		},
	}
	for _, event := range initialEvents {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending initial event %s: %v", event.ID, err)
		}
	}
	if _, err := store.LoadAgentChat(projectID, sessionID); err != nil {
		t.Fatalf("loading initial chat: %v", err)
	}
	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		t.Fatalf("agentSessionHistoryPathFor returned error: %v", err)
	}
	cache := store.chatProjectionCache[path]
	if cache.lastSequence != 2 {
		t.Fatalf("initial projection sequence = %d, want 2", cache.lastSequence)
	}

	nextEvents := []AgentEvent{
		{
			ID:        "second-user",
			SessionID: sessionID,
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.user.message",
			Message:   "第二轮问题",
			CreatedAt: "2026-05-22T01:01:00Z",
		},
		{
			ID:        "second-assistant",
			SessionID: sessionID,
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.message.completed",
			Content:   "第二轮回答",
			CreatedAt: "2026-05-22T01:01:01Z",
		},
	}
	for _, event := range nextEvents {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending next event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, sessionID)
	if err != nil {
		t.Fatalf("loading incrementally projected chat: %v", err)
	}
	joined := joinAgentMessageContent(state.Messages)
	for _, want := range []string{"第一轮问题", "第一轮回答", "第二轮问题", "第二轮回答"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("messages = %#v, want %q after incremental projection", state.Messages, want)
		}
	}
	if store.chatProjectionCache[path].lastSequence != 4 {
		t.Fatalf("projection sequence = %d, want 4", store.chatProjectionCache[path].lastSequence)
	}
}

func TestAppendAgentEventResumesSequenceFromExistingHistory(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-resume"
	sessionID := "session-sequence-resume"

	appendSequenceTestEvent(t, store, projectID, sessionID, "event-1")
	appendSequenceTestEvent(t, store, projectID, sessionID, "event-2")

	// A fresh service (server restart) must seed its cache from the history
	// file instead of restarting sequences.
	reopened := NewService(store.dir, store.agentSessions, store.projects, nil)
	event := appendSequenceTestEvent(t, reopened, projectID, sessionID, "event-3")
	if event.Sequence != 3 {
		t.Fatalf("sequence after reopen = %d, want 3", event.Sequence)
	}
}

func TestClearAgentChatResetsSequenceCache(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-clear"
	sessionID := "session-sequence-clear"

	appendSequenceTestEvent(t, store, projectID, sessionID, "event-1")
	appendSequenceTestEvent(t, store, projectID, sessionID, "event-2")

	if _, err := store.ClearAgentChat(projectID); err != nil {
		t.Fatalf("ClearAgentChat returned error: %v", err)
	}

	event := appendSequenceTestEvent(t, store, projectID, sessionID, "event-4")
	if event.Sequence != 1 {
		t.Fatalf("sequence after clear = %d, want history restart at 1", event.Sequence)
	}
}

func TestAppendAgentEventBuffersDeltaUntilTerminalFlush(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-buffer"
	sessionID := "session-sequence-buffer"

	if _, err := store.AppendAgentEvent(AgentEvent{
		ID:        "user",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-buffer",
		Type:      "agent.user.message",
		Message:   "开始",
	}); err != nil {
		t.Fatalf("appending user event: %v", err)
	}
	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		t.Fatalf("agentSessionHistoryPathFor returned error: %v", err)
	}

	if _, err := store.AppendAgentEvent(AgentEvent{
		ID:        "delta",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-buffer",
		Type:      "agent.message.delta",
		Delta:     "处理中",
	}); err != nil {
		t.Fatalf("appending delta event: %v", err)
	}
	beforeTerminal := readAgentEventHistory(t, path)
	if strings.Contains(beforeTerminal, `"delta"`) {
		t.Fatalf("delta was flushed before terminal event: %s", beforeTerminal)
	}

	if _, err := store.AppendAgentEvent(AgentEvent{
		ID:        "completed",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-buffer",
		Type:      "agent.run.completed",
		Message:   "完成",
	}); err != nil {
		t.Fatalf("appending terminal event: %v", err)
	}
	afterTerminal := readAgentEventHistory(t, path)
	for _, want := range []string{`"user"`, `"delta"`, `"completed"`} {
		if !strings.Contains(afterTerminal, want) {
			t.Fatalf("history = %s, want %s after terminal flush", afterTerminal, want)
		}
	}
}

func TestFlushAgentEventsPersistsBufferedDelta(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-sequence-flush"
	sessionID := "session-sequence-flush"

	if _, err := store.AppendAgentEvent(AgentEvent{
		ID:        "user",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-flush",
		Type:      "agent.user.message",
		Message:   "开始",
	}); err != nil {
		t.Fatalf("appending user event: %v", err)
	}
	path, err := store.agentSessionHistoryPathFor(projectID, sessionID)
	if err != nil {
		t.Fatalf("agentSessionHistoryPathFor returned error: %v", err)
	}
	if _, err := store.AppendAgentEvent(AgentEvent{
		ID:        "delta",
		SessionID: sessionID,
		ProjectID: projectID,
		RunID:     "run-flush",
		Type:      "agent.message.delta",
		Delta:     "处理中",
	}); err != nil {
		t.Fatalf("appending delta event: %v", err)
	}

	if err := store.FlushAgentEvents(); err != nil {
		t.Fatalf("FlushAgentEvents returned error: %v", err)
	}
	history := readAgentEventHistory(t, path)
	if !strings.Contains(history, `"delta"`) {
		t.Fatalf("history = %s, want buffered delta after FlushAgentEvents", history)
	}
}

func readAgentEventHistory(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading event history: %v", err)
	}
	return string(content)
}
