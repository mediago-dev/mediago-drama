package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

func TestAgentRunContextWithoutTimeoutHasNoDeadline(t *testing.T) {
	ctx, cancel := agentRunContext(0)
	defer cancel()

	if deadline, ok := ctx.Deadline(); ok {
		t.Fatalf("Deadline() = %v, true; want no deadline", deadline)
	}

	cancel()
	if err := ctx.Err(); err != context.Canceled {
		t.Fatalf("Err() = %v, want context.Canceled after cancel", err)
	}
}

func TestAgentRunContextWithTimeoutHasDeadline(t *testing.T) {
	ctx, cancel := agentRunContext(time.Minute)
	defer cancel()

	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("Deadline() missing, want timeout deadline")
	}
	if time.Until(deadline) <= 0 {
		t.Fatalf("deadline = %v, want future deadline", deadline)
	}
}

func TestAgentRuntimePublishesFinalMessageAfterStreamedResponse(t *testing.T) {
	workspaceDir := t.TempDir()
	sessions := NewSessionService(nil)
	sessions.Create("session-1", "")

	events := []AgentEvent{}
	eventsCh := make(chan AgentEvent, 16)
	var eventsMu sync.Mutex
	runtime := NewAgentRuntime(
		runtimeTestDocumentStore{dir: workspaceDir},
		sessions,
		streamingFinalAgentRunner{},
		func(event AgentEvent) {
			eventsMu.Lock()
			events = append(events, event)
			eventsMu.Unlock()
			eventsCh <- event
		},
		AgentRuntimeConfig{WorkspaceDir: workspaceDir},
	)

	_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{
		SessionID: "session-1",
		Prompt:    "你好",
	})
	if err != nil {
		t.Fatalf("SubmitAgentMessage returned error: %v", err)
	}
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	waitForAgentEvent(t, eventsCh, "agent.run.completed")

	eventsMu.Lock()
	defer eventsMu.Unlock()
	if !hasAgentEvent(events, "agent.message.delta") {
		t.Fatalf("events = %#v, want streamed delta event", eventTypes(events))
	}
	completed := agentEventOfType(events, "agent.message.completed")
	if completed == nil {
		t.Fatalf("events = %#v, want final completed message event", eventTypes(events))
	}
	if completed.Content != "最终回复" || completed.Message != "最终回复" {
		t.Fatalf("completed = %#v, want final message content", completed)
	}
}

func TestAgentRuntimeSessionTitleUsesSelectedModel(t *testing.T) {
	workspaceDir := t.TempDir()
	sessions := NewSessionService(nil)
	sessions.Create("session-1", "")
	titleRequests := make(chan AgentSessionTitleRequest, 1)
	runtime := NewAgentRuntime(
		runtimeTestDocumentStore{dir: workspaceDir},
		sessions,
		streamingFinalAgentRunner{},
		func(AgentEvent) {},
		AgentRuntimeConfig{
			WorkspaceDir: workspaceDir,
			SessionTitleGenerator: func(_ context.Context, request AgentSessionTitleRequest) (string, error) {
				titleRequests <- request
				return "问候", nil
			},
		},
	)

	_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{
		SessionID: "session-1",
		Prompt:    "你好",
		Model: AgentACPConfigSelection{
			ConfigID: "model",
			Source:   "configOption",
			Value:    "mediago/deepseek-v4-flash",
		},
	})
	if err != nil {
		t.Fatalf("SubmitAgentMessage returned error: %v", err)
	}
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	select {
	case request := <-titleRequests:
		if request.Model.Value != "mediago/deepseek-v4-flash" {
			t.Fatalf("title model = %#v, want selected model", request.Model)
		}
		if !strings.Contains(request.Prompt, "你好") {
			t.Fatalf("title prompt = %q, want user prompt included", request.Prompt)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for title request")
	}
}

func TestAgentRuntimeUserMessageUsesDisplayPrompt(t *testing.T) {
	workspaceDir := t.TempDir()
	sessions := NewSessionService(nil)
	sessions.Create("session-1", "")

	events := []AgentEvent{}
	eventsCh := make(chan AgentEvent, 16)
	var eventsMu sync.Mutex
	runtime := NewAgentRuntime(
		runtimeTestDocumentStore{dir: workspaceDir},
		sessions,
		streamingFinalAgentRunner{},
		func(event AgentEvent) {
			eventsMu.Lock()
			events = append(events, event)
			eventsMu.Unlock()
			eventsCh <- event
		},
		AgentRuntimeConfig{WorkspaceDir: workspaceDir},
	)

	displayMetadata := map[string]any{
		"displaySegments": []any{
			map[string]any{"type": "skill", "name": "screenplay-writer", "title": "剧本写作"},
		},
	}
	_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{
		SessionID:       "session-1",
		Prompt:          "请先调用 MCP `load_skill` 装载 `screenplay-writer`（剧本写作），并使用该 Skill 完成以下需求：理解一下",
		DisplayPrompt:   "剧本写作 理解一下",
		DisplayMetadata: displayMetadata,
	})
	if err != nil {
		t.Fatalf("SubmitAgentMessage returned error: %v", err)
	}
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	waitForAgentEvent(t, eventsCh, "agent.run.completed")

	eventsMu.Lock()
	defer eventsMu.Unlock()
	userMessage := agentEventOfType(events, "agent.user.message")
	if userMessage == nil {
		t.Fatalf("events = %#v, want user message event", eventTypes(events))
	}
	if userMessage.Message != "剧本写作 理解一下" {
		t.Fatalf("user message = %q, want display prompt instead of machine prompt", userMessage.Message)
	}
	if _, ok := userMessage.Metadata["displaySegments"]; !ok {
		t.Fatalf("user message metadata = %#v, want display segments", userMessage.Metadata)
	}
}

func TestUserMessageDisplayText(t *testing.T) {
	tests := []struct {
		name    string
		payload AgentMessageRequest
		want    string
	}{
		{
			name:    "machine prompt without display data",
			payload: AgentMessageRequest{Prompt: "@文件 读一下"},
			want:    "@文件 读一下",
		},
		{
			name:    "display prompt wins over machine prompt",
			payload: AgentMessageRequest{Prompt: "@文件 读一下", DisplayPrompt: "读一下"},
			want:    "读一下",
		},
		{
			name: "attachment-only send keeps the bubble text empty",
			payload: AgentMessageRequest{
				Prompt: "@文件",
				DisplayMetadata: map[string]any{
					"displayAttachments": []any{map[string]any{"kind": "file", "name": "文件"}},
				},
			},
			want: "",
		},
		{
			name: "metadata without renderable content falls back to the machine prompt",
			payload: AgentMessageRequest{
				Prompt:          "@文件 读一下",
				DisplayMetadata: map[string]any{"displayAttachments": []any{}},
			},
			want: "@文件 读一下",
		},
		{
			name:    "empty metadata object falls back to the machine prompt",
			payload: AgentMessageRequest{Prompt: "@文件 读一下", DisplayMetadata: map[string]any{}},
			want:    "@文件 读一下",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := userMessageDisplayText(test.payload); got != test.want {
				t.Fatalf("userMessageDisplayText = %q, want %q", got, test.want)
			}
		})
	}
}

type streamingFinalAgentRunner struct{}

func (streamingFinalAgentRunner) Run(
	_ context.Context,
	_ AgentRunRequest,
	publish func(AgentEvent),
) (AgentRunResult, error) {
	publish(AgentEvent{
		Type:    "agent.message.delta",
		Message: "最终",
		Delta:   "最终",
	})
	return AgentRunResult{
		Message:         "最终回复",
		StreamedMessage: true,
	}, nil
}

type runtimeTestDocumentStore struct {
	dir string
}

func (store runtimeTestDocumentStore) Dir() string {
	return store.dir
}

func (store runtimeTestDocumentStore) ProjectDir(projectID string) (string, error) {
	dir := filepath.Join(store.dir, projectID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func (runtimeTestDocumentStore) ListWorkspaceDocuments(string) (model.WorkspaceDocumentsResponse, error) {
	return model.WorkspaceDocumentsResponse{}, nil
}

func (runtimeTestDocumentStore) GetWorkspaceDocument(string, string) (mediamcp.WorkspaceDocument, bool, error) {
	return mediamcp.WorkspaceDocument{}, false, nil
}

func (runtimeTestDocumentStore) UpdateWorkspaceDocument(
	string,
	string,
	model.UpdateWorkspaceDocumentRequest,
) (mediamcp.WorkspaceDocument, model.WorkspaceDocumentsResponse, error) {
	return mediamcp.WorkspaceDocument{}, model.WorkspaceDocumentsResponse{}, nil
}

func (runtimeTestDocumentStore) AppendDocumentOperationLog(string, model.DocumentOperationLogRecord) error {
	return nil
}

func waitForAgentEvent(t *testing.T, events <-chan AgentEvent, eventType string) {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type == eventType {
				return
			}
		case <-timeout:
			t.Fatalf("timed out waiting for %s", eventType)
		}
	}
}

func hasAgentEvent(events []AgentEvent, eventType string) bool {
	return agentEventOfType(events, eventType) != nil
}

func agentEventOfType(events []AgentEvent, eventType string) *AgentEvent {
	for index := range events {
		if events[index].Type == eventType {
			return &events[index]
		}
	}
	return nil
}

func eventTypes(events []AgentEvent) []string {
	types := make([]string, 0, len(events))
	for _, event := range events {
		types = append(types, event.Type)
	}
	return types
}
