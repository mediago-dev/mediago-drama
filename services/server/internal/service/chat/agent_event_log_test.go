package chat

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
)

func newTestChatStore(t *testing.T) *Service {
	t.Helper()
	store, _ := newTestChatStoreWithDB(t)
	return store
}

func newTestChatStoreWithDB(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("opening workspace db: %v", err)
	}
	workspaceDir := t.TempDir()
	projects := testProjectProvider{root: workspaceDir}
	store := NewService(workspaceDir, repository.NewAgentSessionRepository(db), projects, nil)
	return store, db
}

type testProjectProvider struct {
	root string
}

func (provider testProjectProvider) EnsureProjectRecord(projectID string) error {
	_, err := provider.ProjectDir(projectID)
	return err
}

func (provider testProjectProvider) ProjectDir(projectID string) (string, error) {
	dir := filepath.Join(provider.root, projectID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func TestAgentChatSnapshotIncludesAllRootRunsInProjectSession(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-chat-history"
	events := []AgentEvent{
		{
			ID:        "other-user",
			SessionID: "session-other",
			ProjectID: projectID,
			RunID:     "run-other",
			Type:      "agent.user.message",
			Message:   "其他会话问题",
			CreatedAt: "2026-05-22T00:59:00Z",
		},
		{
			ID:        "old-user",
			SessionID: "session-main",
			ProjectID: projectID,
			RunID:     "run-old",
			Type:      "agent.user.message",
			Message:   "第一轮问题",
			CreatedAt: "2026-05-22T01:00:00Z",
		},
		{
			ID:        "old-assistant",
			SessionID: "session-main",
			ProjectID: projectID,
			RunID:     "run-old",
			Type:      "agent.message.completed",
			Content:   "第一轮回答",
			CreatedAt: "2026-05-22T01:00:01Z",
		},
		{
			ID:        "new-user",
			SessionID: "session-main",
			ProjectID: projectID,
			RunID:     "run-new",
			Type:      "agent.user.message",
			Message:   "第二轮问题",
			CreatedAt: "2026-05-22T01:01:00Z",
		},
		{
			ID:        "new-assistant",
			SessionID: "session-main",
			ProjectID: projectID,
			RunID:     "run-new",
			Type:      "agent.message.completed",
			Content:   "第二轮回答",
			CreatedAt: "2026-05-22T01:01:01Z",
		},
	}
	for _, event := range events {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, "")
	if err != nil {
		t.Fatalf("loading agent chat: %v", err)
	}
	if state.SessionID != "session-main" {
		t.Fatalf("sessionID = %q, want latest session-main", state.SessionID)
	}
	contents := []string{}
	for _, message := range state.Messages {
		contents = append(contents, message.Content)
	}
	joined := strings.Join(contents, "\n")
	if !strings.Contains(joined, "第一轮问题") || !strings.Contains(joined, "第二轮回答") {
		t.Fatalf("messages = %#v, want both root runs in session", state.Messages)
	}
	if strings.Contains(joined, "其他会话问题") {
		t.Fatalf("messages = %#v, should not include another session", state.Messages)
	}
	if strings.Index(joined, "第一轮问题") > strings.Index(joined, "第二轮问题") {
		t.Fatalf("messages = %#v, want chronological root history", state.Messages)
	}
}

func TestAgentChatSnapshotSeparatesStreamingRunsAfterTerminalEvent(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-streaming-runs"
	events := []AgentEvent{
		{
			ID:        "first-user",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.user.message",
			Message:   "第一轮问题",
			CreatedAt: "2026-05-22T01:00:00Z",
		},
		{
			ID:        "first-delta",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.message.delta",
			Delta:     "第一轮回答",
			CreatedAt: "2026-05-22T01:00:01Z",
		},
		{
			ID:        "first-completed",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.run.completed",
			Message:   "Agent 运行已完成。",
			CreatedAt: "2026-05-22T01:00:02Z",
		},
		{
			ID:        "second-user",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.user.message",
			Message:   "第二轮问题",
			CreatedAt: "2026-05-22T01:01:00Z",
		},
		{
			ID:        "second-delta",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.message.delta",
			Delta:     "第二轮回答",
			CreatedAt: "2026-05-22T01:01:01Z",
		},
		{
			ID:        "second-completed",
			SessionID: "session-streaming",
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.run.completed",
			Message:   "Agent 运行已完成。",
			CreatedAt: "2026-05-22T01:01:02Z",
		},
	}
	for _, event := range events {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, "session-streaming")
	if err != nil {
		t.Fatalf("loading agent chat: %v", err)
	}
	got := []string{}
	for _, message := range state.Messages {
		got = append(got, message.Role+":"+message.Content)
	}
	want := []string{
		"user:第一轮问题",
		"assistant:第一轮回答",
		"user:第二轮问题",
		"assistant:第二轮回答",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("messages = %#v, want separate streaming runs", state.Messages)
	}
}

func TestAgentChatProjectionUsesPausedRunStatusFromPersistence(t *testing.T) {
	projectID := "project-chat-paused"
	sessionID := "session-paused"
	state, _ := projectAgentChatState(projectID, sessionID, AgentChatStateResponse{
		ProjectID: projectID,
		SessionID: sessionID,
		Running:   true,
		Messages:  []AgentChatMessageRecord{},
		Activity:  []AgentChatActivityRecord{},
	}, nil, 0)

	if state.Running {
		t.Fatalf("Running = true, want false for session transcript projection")
	}
}

func TestAgentChatSnapshotCanLoadRequestedProjectSession(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-chat-session-select"
	events := []AgentEvent{
		{
			ID:        "first-user",
			SessionID: "session-first",
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.user.message",
			Message:   "第一会话",
			CreatedAt: "2026-05-22T01:00:00Z",
		},
		{
			ID:        "first-assistant",
			SessionID: "session-first",
			ProjectID: projectID,
			RunID:     "run-first",
			Type:      "agent.message.completed",
			Content:   "第一回答",
			CreatedAt: "2026-05-22T01:00:01Z",
		},
		{
			ID:        "second-user",
			SessionID: "session-second",
			ProjectID: projectID,
			RunID:     "run-second",
			Type:      "agent.user.message",
			Message:   "第二会话",
			CreatedAt: "2026-05-22T01:01:00Z",
		},
	}
	for _, event := range events {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, "session-first")
	if err != nil {
		t.Fatalf("loading requested session chat: %v", err)
	}
	if state.SessionID != "session-first" {
		t.Fatalf("sessionID = %q, want requested session-first", state.SessionID)
	}
	joined := ""
	for _, message := range state.Messages {
		joined += message.Content + "\n"
	}
	if !strings.Contains(joined, "第一会话") || !strings.Contains(joined, "第一回答") {
		t.Fatalf("messages = %#v, want first session content", state.Messages)
	}
	if strings.Contains(joined, "第二会话") {
		t.Fatalf("messages = %#v, should not include second session", state.Messages)
	}
}

func TestAgentChatSnapshotProjectsStructuredACPEvents(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-acp-history"
	events := []AgentEvent{
		{
			ID:        "acp-user",
			SessionID: "session-acp",
			ProjectID: projectID,
			RunID:     "run-acp",
			Type:      "agent.user.message",
			Message:   "改 README",
			CreatedAt: "2026-05-22T01:00:00Z",
		},
		{
			ID:        "acp-message-delta",
			SessionID: "session-acp",
			ProjectID: projectID,
			RunID:     "run-acp",
			Type:      "agent.message.delta",
			Message:   "我会先读取 README。",
			Delta:     "我会先读取 README。",
			CreatedAt: "2026-05-22T01:00:00.500Z",
		},
		{
			ID:        "acp-tool-start",
			SessionID: "session-acp",
			ProjectID: projectID,
			RunID:     "run-acp",
			Type:      "agent.acp",
			Message:   "工具调用：编辑 README（运行中）",
			CreatedAt: "2026-05-22T01:00:01Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCall",
				ToolCallID: "call-edit",
				ToolKind:   "edit",
				Title:      "编辑 README",
				Status:     "in_progress",
				RawInput:   json.RawMessage(`{"path":"README.md"}`),
				Locations:  []AgentACPLocation{{Path: "README.md"}},
			},
		},
		{
			ID:        "acp-tool-done",
			SessionID: "session-acp",
			ProjectID: projectID,
			RunID:     "run-acp",
			Type:      "agent.acp",
			Message:   "工具调用：编辑 README（完成）",
			CreatedAt: "2026-05-22T01:00:02Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCallUpdate",
				ToolCallID: "call-edit",
				ToolKind:   "edit",
				Title:      "编辑 README",
				Status:     "completed",
				RawOutput:  json.RawMessage(`{"ok":true}`),
				Content: []AgentACPContentBlock{{
					Type:    "diff",
					Path:    "README.md",
					OldText: "old\n",
					NewText: "new\n",
				}},
			},
		},
		{
			ID:        "acp-message-completed",
			SessionID: "session-acp",
			ProjectID: projectID,
			RunID:     "run-acp",
			Type:      "agent.message.completed",
			Message:   "README 已更新。",
			Content:   "README 已更新。",
			CreatedAt: "2026-05-22T01:00:03Z",
		},
	}
	for _, event := range events {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, "")
	if err != nil {
		t.Fatalf("loading agent chat: %v", err)
	}
	messages := state.Messages
	if len(messages) < 3 {
		t.Fatalf("messages = %#v, want user, assistant, tool", messages)
	}
	if messages[1].Kind != "message" || messages[1].Content != "我会先读取 README。" {
		t.Fatalf("messages = %#v, want assistant message before tool", messages)
	}
	if messages[2].Kind != "tool" {
		t.Fatalf("messages = %#v, want tool after assistant message", messages)
	}
	var toolMessage *AgentChatMessageRecord
	for index := range messages {
		if messages[index].Kind == "tool" {
			toolMessage = &messages[index]
			break
		}
	}
	if toolMessage == nil {
		t.Fatalf("messages = %#v, want projected ACP tool", messages)
	}
	if toolMessage.Metadata["toolCallId"] != "call-edit" || toolMessage.Metadata["acpKind"] != "edit" {
		t.Fatalf("metadata = %#v, want ACP tool identifiers", toolMessage.Metadata)
	}
	blocks, ok := toolMessage.Metadata["outputBlocks"].([]AgentACPContentBlock)
	if !ok || len(blocks) != 1 || blocks[0].Type != "diff" {
		t.Fatalf("outputBlocks = %#v, want diff block", toolMessage.Metadata["outputBlocks"])
	}
	if toolMessage.Metadata["status"] != "completed" || toolMessage.Status != "complete" {
		t.Fatalf("tool status = %q metadata=%#v, want completed", toolMessage.Status, toolMessage.Metadata)
	}
}

func TestAgentChatSnapshotProjectsLegacyRuntimeLogToolUpdate(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-runtime-log"
	logText := "ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---"
	event := AgentEvent{
		ID:        "legacy-runtime-log",
		SessionID: "session-runtime-log",
		ProjectID: projectID,
		RunID:     "run-runtime-log",
		Type:      "agent.acp",
		Message:   "工具调用：2026-06-03T09:43:13Z（失败）",
		CreatedAt: "2026-06-03T09:43:13Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCallUpdate",
			ToolCallID: "2026-06-03T09:43:13Z",
			ToolKind:   "other",
			Status:     "failed",
			Content: []AgentACPContentBlock{{
				Type: "text",
				Text: logText,
			}},
		},
	}
	if _, err := store.AppendAgentEvent(event); err != nil {
		t.Fatalf("appending runtime log: %v", err)
	}

	state, err := store.LoadAgentChat(projectID, "")
	if err != nil {
		t.Fatalf("loading agent chat: %v", err)
	}
	messages := state.Messages
	if len(messages) != 1 {
		t.Fatalf("messages = %#v, want one runtime log", messages)
	}
	message := messages[0]
	if message.Kind != "runtime" || message.Title != "运行日志" {
		t.Fatalf("message = %#v, want runtime log", message)
	}
	if message.Metadata["runtimeLog"] != true || message.Metadata["toolName"] != "运行日志" {
		t.Fatalf("metadata = %#v, want visible runtime log metadata", message.Metadata)
	}
}

func TestAgentChatSnapshotKeepsAssistantTextInterleavedWithTools(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-interleaved-chat"
	events := []AgentEvent{
		{
			ID:        "user",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.user.message",
			Message:   "处理剧本",
			CreatedAt: "2026-05-22T02:00:00Z",
		},
		{
			ID:        "message-before-read",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.message.delta",
			Message:   "我先读取素材。",
			Delta:     "我先读取素材。",
			CreatedAt: "2026-05-22T02:00:01Z",
		},
		{
			ID:        "tool-read-start",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.acp",
			Message:   "工具调用：Read SKILL.md（运行中）",
			CreatedAt: "2026-05-22T02:00:02Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCall",
				ToolCallID: "call-read",
				ToolKind:   "read",
				Title:      "Read SKILL.md",
				Status:     "in_progress",
			},
		},
		{
			ID:        "tool-read-done",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.acp",
			Message:   "工具调用：Read SKILL.md（完成）",
			CreatedAt: "2026-05-22T02:00:03Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCallUpdate",
				ToolCallID: "call-read",
				ToolKind:   "read",
				Title:      "Read SKILL.md",
				Status:     "completed",
			},
		},
		{
			ID:        "message-before-write",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.message.delta",
			Message:   "读取完成，开始写入。",
			Delta:     "读取完成，开始写入。",
			CreatedAt: "2026-05-22T02:00:04Z",
		},
		{
			ID:        "tool-write-start",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.acp",
			Message:   "工具调用：Write document（运行中）",
			CreatedAt: "2026-05-22T02:00:05Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCall",
				ToolCallID: "call-write",
				ToolKind:   "edit",
				Title:      "Write document",
				Status:     "in_progress",
			},
		},
		{
			ID:        "tool-write-done",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.acp",
			Message:   "工具调用：Write document（完成）",
			CreatedAt: "2026-05-22T02:00:06Z",
			ACP: &AgentACPEvent{
				Kind:       "toolCallUpdate",
				ToolCallID: "call-write",
				ToolKind:   "edit",
				Title:      "Write document",
				Status:     "completed",
			},
		},
		{
			ID:        "message-after-write",
			SessionID: "session-interleaved",
			ProjectID: projectID,
			RunID:     "run-interleaved",
			Type:      "agent.message.delta",
			Message:   "写入完成。",
			Delta:     "写入完成。",
			CreatedAt: "2026-05-22T02:00:07Z",
		},
	}
	for _, event := range events {
		if _, err := store.AppendAgentEvent(event); err != nil {
			t.Fatalf("appending event %s: %v", event.ID, err)
		}
	}

	state, err := store.LoadAgentChat(projectID, "")
	if err != nil {
		t.Fatalf("loading agent chat: %v", err)
	}
	messages := state.Messages
	if len(messages) < 6 {
		t.Fatalf("messages = %#v, want user plus interleaved assistant/tool entries", messages)
	}
	got := []string{
		messages[1].Kind + ":" + messages[1].Content,
		messages[2].Kind + ":" + messages[2].Title,
		messages[3].Kind + ":" + messages[3].Content,
		messages[4].Kind + ":" + messages[4].Title,
		messages[5].Kind + ":" + messages[5].Content,
	}
	want := []string{
		"message:我先读取素材。",
		"tool:Read SKILL.md",
		"message:读取完成，开始写入。",
		"tool:Write document",
		"message:写入完成。",
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("entry %d = %q, want %q; messages = %#v", index, got[index], want[index], messages)
		}
	}
}

func TestAgentChatConcurrentLoadsSerializeProjectionCaches(t *testing.T) {
	store := newTestChatStore(t)
	projectID := "project-concurrent-chat-load"
	sessionID := "session-concurrent-chat-load"
	for index := range 50 {
		if _, err := store.AppendAgentEvent(AgentEvent{
			ID:        fmt.Sprintf("event-%02d", index),
			SessionID: sessionID,
			ProjectID: projectID,
			RunID:     "run-concurrent",
			Type:      "agent.message.delta",
			Message:   fmt.Sprintf("片段 %02d", index),
			Delta:     fmt.Sprintf("片段 %02d", index),
			CreatedAt: fmt.Sprintf("2026-05-22T02:01:%02dZ", index%60),
		}); err != nil {
			t.Fatalf("appending event %d: %v", index, err)
		}
	}

	const goroutineCount = 24
	const iterationCount = 40
	start := make(chan struct{})
	errs := make(chan error, goroutineCount*iterationCount*2)
	var wg sync.WaitGroup
	for worker := range goroutineCount {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			for iteration := range iterationCount {
				if _, err := store.LoadAgentChat(projectID, sessionID); err != nil {
					errs <- fmt.Errorf("worker %d chat load %d: %w", worker, iteration, err)
				}
				if _, err := store.LoadAgentEvents(projectID, sessionID, 0, 1000); err != nil {
					errs <- fmt.Errorf("worker %d event load %d: %w", worker, iteration, err)
				}
			}
		}(worker)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
}

func joinAgentMessageContent(messages []AgentChatMessageRecord) string {
	contents := make([]string, 0, len(messages))
	for _, message := range messages {
		contents = append(contents, message.Content)
	}
	return strings.Join(contents, "\n")
}
