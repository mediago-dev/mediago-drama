package agent

import (
	"context"
	"net/http"
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

func TestAgentRuntimeCloseLifecycle(t *testing.T) {
	tests := []struct {
		name string
		run  func(t *testing.T)
	}{
		{
			name: "concurrent close cancels run and title workers",
			run: func(t *testing.T) {
				workspaceDir := t.TempDir()
				sessions := NewSessionService(nil)
				sessions.Create("session-1", "")
				runnerStarted := make(chan struct{})
				runnerCancelled := make(chan struct{})
				titleStarted := make(chan struct{})
				titleCancelled := make(chan struct{})
				runtime := NewAgentRuntime(
					runtimeTestDocumentStore{dir: workspaceDir},
					sessions,
					blockingLifecycleAgentRunner{started: runnerStarted, cancelled: runnerCancelled},
					func(AgentEvent) {},
					AgentRuntimeConfig{
						WorkspaceDir: workspaceDir,
						SessionTitleGenerator: func(ctx context.Context, _ AgentSessionTitleRequest) (string, error) {
							close(titleStarted)
							<-ctx.Done()
							close(titleCancelled)
							return "", ctx.Err()
						},
					},
				)

				_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{SessionID: "session-1", Prompt: "hello"})
				if err != nil || status != http.StatusOK {
					t.Fatalf("SubmitAgentMessage() status = %d, err = %v", status, err)
				}
				waitForLifecycleSignal(t, runnerStarted, "runner start")
				waitForLifecycleSignal(t, titleStarted, "title start")

				const closerCount = 8
				var closers sync.WaitGroup
				closers.Add(closerCount)
				for range closerCount {
					go func() {
						defer closers.Done()
						runtime.Close()
					}()
				}
				allClosed := make(chan struct{})
				go func() {
					closers.Wait()
					close(allClosed)
				}()

				waitForLifecycleSignal(t, allClosed, "concurrent Close calls")
				waitForLifecycleSignal(t, runnerCancelled, "runner cancellation")
				waitForLifecycleSignal(t, titleCancelled, "title cancellation")
			},
		},
		{
			name: "close waits for terminal event persistence",
			run: func(t *testing.T) {
				workspaceDir := t.TempDir()
				sessions := NewSessionService(nil)
				sessions.Create("session-1", "")
				terminalPublishStarted := make(chan struct{})
				releaseTerminalPublish := make(chan struct{})
				runtime := NewAgentRuntime(
					runtimeTestDocumentStore{dir: workspaceDir},
					sessions,
					streamingFinalAgentRunner{},
					func(event AgentEvent) {
						if event.Type != "agent.run.completed" {
							return
						}
						close(terminalPublishStarted)
						<-releaseTerminalPublish
					},
					AgentRuntimeConfig{WorkspaceDir: workspaceDir},
				)

				_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{SessionID: "session-1", Prompt: "hello"})
				if err != nil || status != http.StatusOK {
					t.Fatalf("SubmitAgentMessage() status = %d, err = %v", status, err)
				}
				waitForLifecycleSignal(t, terminalPublishStarted, "terminal publish")
				if got := sessions.Status("session-1").LastStatus; got != "completed" {
					t.Fatalf("session status = %q, want completed before terminal publish returns", got)
				}

				closeStarted := make(chan struct{})
				closeDone := make(chan struct{})
				go func() {
					close(closeStarted)
					runtime.Close()
					close(closeDone)
				}()
				waitForLifecycleSignal(t, closeStarted, "Close start")
				select {
				case <-closeDone:
					t.Fatal("Close returned before terminal event persistence finished")
				case <-time.After(50 * time.Millisecond):
				}

				close(releaseTerminalPublish)
				waitForLifecycleSignal(t, closeDone, "Close completion")
			},
		},
		{
			name: "close terminates a closable runner before waiting for its run",
			run: func(t *testing.T) {
				workspaceDir := t.TempDir()
				sessions := NewSessionService(nil)
				sessions.Create("session-1", "")
				runner := &closableLifecycleAgentRunner{
					started:     make(chan struct{}),
					closeCalled: make(chan struct{}),
					runExited:   make(chan struct{}),
				}
				runtime := NewAgentRuntime(
					runtimeTestDocumentStore{dir: workspaceDir},
					sessions,
					runner,
					func(AgentEvent) {},
					AgentRuntimeConfig{WorkspaceDir: workspaceDir},
				)

				_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{SessionID: "session-1", Prompt: "hello"})
				if err != nil || status != http.StatusOK {
					t.Fatalf("SubmitAgentMessage() status = %d, err = %v", status, err)
				}
				waitForLifecycleSignal(t, runner.started, "runner start")

				const closerCount = 8
				var closers sync.WaitGroup
				closers.Add(closerCount)
				for range closerCount {
					go func() {
						defer closers.Done()
						runtime.Close()
					}()
				}
				allClosed := make(chan struct{})
				go func() {
					closers.Wait()
					close(allClosed)
				}()

				waitForLifecycleSignal(t, runner.closeCalled, "runner Close")
				waitForLifecycleSignal(t, runner.runExited, "runner exit after Close")
				waitForLifecycleSignal(t, allClosed, "concurrent runtime Close calls")
				if got := runner.CloseCount(); got != 1 {
					t.Fatalf("runner Close calls = %d, want 1", got)
				}
			},
		},
		{
			name: "submit after close is unavailable",
			run: func(t *testing.T) {
				workspaceDir := t.TempDir()
				sessions := NewSessionService(nil)
				sessions.Create("session-1", "")
				runnerCalled := make(chan struct{}, 1)
				runtime := NewAgentRuntime(
					runtimeTestDocumentStore{dir: workspaceDir},
					sessions,
					notifyingLifecycleAgentRunner{called: runnerCalled},
					func(AgentEvent) {},
					AgentRuntimeConfig{WorkspaceDir: workspaceDir},
				)

				runtime.Close()
				runtime.Close()
				_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{SessionID: "session-1", Prompt: "hello"})
				if status != http.StatusServiceUnavailable || err == nil || !strings.Contains(err.Error(), "closed") {
					t.Fatalf("SubmitAgentMessage() status = %d, err = %v; want 503 closed", status, err)
				}
				select {
				case <-runnerCalled:
					t.Fatal("runner was called after runtime Close")
				default:
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, test.run)
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
	delta := agentEventOfType(events, "agent.message.delta")
	completed := agentEventOfType(events, "agent.message.completed")
	if completed == nil {
		t.Fatalf("events = %#v, want final completed message event", eventTypes(events))
	}
	if completed.Content != "最终回复" || completed.Message != "最终回复" {
		t.Fatalf("completed = %#v, want final message content", completed)
	}
	if completed.ItemID != "message-final-1" || completed.TurnID == "" || completed.Phase != AgentMessagePhaseFinalAnswer {
		t.Fatalf("completed semantics = %#v, want streamed item completed as final answer", completed)
	}
	if delta == nil || delta.ItemID != completed.ItemID || delta.Phase != AgentMessagePhaseCommentary {
		t.Fatalf("delta semantics = %#v, want same item as running commentary", delta)
	}
}

func TestAgentRuntimeReportsAuthoritativeTerminalState(t *testing.T) {
	t.Run("completed", func(t *testing.T) {
		workspaceDir := t.TempDir()
		sessions := NewSessionService(nil)
		sessions.Create("session-1", "project-1")
		terminalEvents := make(chan AgentRunTerminalEvent, 1)
		runtime := NewAgentRuntime(
			runtimeTestDocumentStore{dir: workspaceDir},
			sessions,
			streamingFinalAgentRunner{},
			func(AgentEvent) {},
			AgentRuntimeConfig{
				WorkspaceDir:       workspaceDir,
				RunTerminalHandler: func(event AgentRunTerminalEvent) { terminalEvents <- event },
			},
		)
		defer runtime.Close()

		_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{
			SessionID: "session-1",
			ProjectID: "project-1",
			Prompt:    "hello",
		})
		if err != nil || status != http.StatusOK {
			t.Fatalf("SubmitAgentMessage() status = %d, err = %v", status, err)
		}
		select {
		case event := <-terminalEvents:
			if event.SessionID != "session-1" || event.ProjectID != "project-1" ||
				event.RunID == "" || event.Status != "completed" {
				t.Fatalf("terminal event = %#v, want completed run context", event)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for completed terminal event")
		}
	})

	t.Run("cancelled", func(t *testing.T) {
		workspaceDir := t.TempDir()
		sessions := NewSessionService(nil)
		sessions.Create("session-1", "project-1")
		runnerStarted := make(chan struct{})
		runnerCancelled := make(chan struct{})
		terminalEvents := make(chan AgentRunTerminalEvent, 1)
		runtime := NewAgentRuntime(
			runtimeTestDocumentStore{dir: workspaceDir},
			sessions,
			blockingLifecycleAgentRunner{started: runnerStarted, cancelled: runnerCancelled},
			func(AgentEvent) {},
			AgentRuntimeConfig{
				WorkspaceDir:       workspaceDir,
				RunTerminalHandler: func(event AgentRunTerminalEvent) { terminalEvents <- event },
			},
		)
		defer runtime.Close()

		_, status, err := runtime.SubmitAgentMessage(AgentMessageRequest{
			SessionID: "session-1",
			ProjectID: "project-1",
			Prompt:    "hello",
		})
		if err != nil || status != http.StatusOK {
			t.Fatalf("SubmitAgentMessage() status = %d, err = %v", status, err)
		}
		waitForLifecycleSignal(t, runnerStarted, "runner start")
		if _, cancelled := sessions.CancelRun("session-1"); !cancelled {
			t.Fatal("CancelRun() cancelled = false, want true")
		}
		waitForLifecycleSignal(t, runnerCancelled, "runner cancellation")

		select {
		case event := <-terminalEvents:
			if event.RunID == "" || event.Status != "cancelled" {
				t.Fatalf("terminal event = %#v, want cancelled run", event)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for cancelled terminal event")
		}
	})
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
		ItemID:  "message-final-1",
	})
	return AgentRunResult{
		Message:         "最终回复",
		MessageItemID:   "message-final-1",
		StreamedMessage: true,
	}, nil
}

type blockingLifecycleAgentRunner struct {
	started   chan struct{}
	cancelled chan struct{}
}

func (runner blockingLifecycleAgentRunner) Run(
	ctx context.Context,
	_ AgentRunRequest,
	_ func(AgentEvent),
) (AgentRunResult, error) {
	close(runner.started)
	<-ctx.Done()
	close(runner.cancelled)
	return AgentRunResult{}, ctx.Err()
}

type notifyingLifecycleAgentRunner struct {
	called chan struct{}
}

type closableLifecycleAgentRunner struct {
	started      chan struct{}
	closeCalled  chan struct{}
	runExited    chan struct{}
	closeSignal  sync.Once
	closeCountMu sync.Mutex
	closeCount   int
}

func (runner *closableLifecycleAgentRunner) Run(
	ctx context.Context,
	_ AgentRunRequest,
	_ func(AgentEvent),
) (AgentRunResult, error) {
	close(runner.started)
	<-ctx.Done()
	<-runner.closeCalled
	close(runner.runExited)
	return AgentRunResult{}, ctx.Err()
}

func (runner *closableLifecycleAgentRunner) Close() error {
	runner.closeCountMu.Lock()
	runner.closeCount++
	runner.closeCountMu.Unlock()
	runner.closeSignal.Do(func() {
		close(runner.closeCalled)
	})
	return nil
}

func (runner *closableLifecycleAgentRunner) CloseCount() int {
	runner.closeCountMu.Lock()
	defer runner.closeCountMu.Unlock()
	return runner.closeCount
}

func (runner notifyingLifecycleAgentRunner) Run(
	_ context.Context,
	_ AgentRunRequest,
	_ func(AgentEvent),
) (AgentRunResult, error) {
	runner.called <- struct{}{}
	return AgentRunResult{}, nil
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

func waitForLifecycleSignal(t *testing.T, signal <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
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
