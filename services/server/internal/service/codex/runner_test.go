package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
)

type nativeCall struct {
	method string
	params map[string]any
}
type nativeReply struct {
	value any
	err   *codexapp.RPCError
}
type nativeClient struct {
	mu          sync.Mutex
	calls       []nativeCall
	events      chan codexapp.Message
	replies     chan nativeReply
	status      string
	resumeError error
}

func newNativeClient() *nativeClient {
	return &nativeClient{events: make(chan codexapp.Message, 32), replies: make(chan nativeReply, 8), status: "completed"}
}
func (c *nativeClient) Call(_ context.Context, method string, params any, out any) error {
	c.mu.Lock()
	c.calls = append(c.calls, nativeCall{method, params.(map[string]any)})
	c.mu.Unlock()
	var value any
	switch method {
	case "thread/resume":
		if c.resumeError != nil {
			return c.resumeError
		}
		fallthrough
	case "thread/start":
		value = map[string]any{"thread": map[string]string{"id": "native-thread"}}
	case "turn/start":
		value = map[string]any{"turn": map[string]string{"id": "native-turn"}}
		c.events <- nativeMessage("item/started", `{"threadId":"native-thread","turnId":"native-turn","item":{"id":"answer","type":"agentMessage","phase":"final_answer"}}`)
		c.events <- nativeMessage("item/agentMessage/delta", `{"threadId":"native-thread","turnId":"native-turn","itemId":"answer","delta":"回答"}`)
		c.events <- nativeMessage("item/completed", `{"threadId":"native-thread","turnId":"native-turn","item":{"id":"answer","type":"agentMessage","phase":"final_answer","text":"回答"}}`)
		c.events <- nativeMessage("turn/completed", fmt.Sprintf(`{"threadId":"native-thread","turn":{"id":"native-turn","status":%q,"error":{"message":"turn rejected"}}}`, c.status))
	case "turn/interrupt":
		return nil
	default:
		return fmt.Errorf("unexpected call: %s", method)
	}
	raw, _ := json.Marshal(value)
	return json.Unmarshal(raw, out)
}
func (c *nativeClient) Next(ctx context.Context) (codexapp.Message, error) {
	select {
	case m := <-c.events:
		return m, nil
	case <-ctx.Done():
		return codexapp.Message{}, ctx.Err()
	}
}
func (c *nativeClient) Respond(_ context.Context, _ json.RawMessage, value any, err *codexapp.RPCError) error {
	c.replies <- nativeReply{value, err}
	return nil
}
func (c *nativeClient) Close() {}
func nativeMessage(method, params string) codexapp.Message {
	return codexapp.Message{Method: method, Params: json.RawMessage(params)}
}
func nativeRunner(t *testing.T, client *nativeClient) *Runner {
	t.Helper()
	r := NewRuntimeAgentRunnerWithDocumentMCPConfigPathAndArgv("codex", t.TempDir(), "", func(AgentRunRequest) string { return "固定指引" }, nil, nil)
	r.sessionFactory = func(context.Context, string, codexapp.Options) (codexapp.Client, error) { return client, nil }
	t.Cleanup(func() { _ = r.Close() })
	return r
}
func TestNativeRunnerStartsResumesAndRefreshesRunTools(t *testing.T) {
	client := newNativeClient()
	r := nativeRunner(t, client)
	r.SetSessionRecapBuilder(func(context.Context, AgentRunRequest) string { return "历史决定：使用中文" })
	req := AgentRunRequest{ProjectID: "project-one", SessionID: "session-one", RunID: "run-one", Prompt: "继续", BridgeURL: "http://127.0.0.1:53214", BridgeToken: "test-token"}
	var events []AgentEvent
	first, err := r.Run(context.Background(), req, func(e AgentEvent) { events = append(events, e) })
	if err != nil || first.Message != "回答" || !first.StreamedMessage {
		t.Fatalf("%#v %v", first, err)
	}
	if first.CodexThreadID != "native-thread" || !strings.HasPrefix(first.CodexInstructionHash, "codex-v1:") {
		t.Fatalf("%#v", first)
	}
	if len(events) != 2 || events[0].Phase != "final_answer" {
		t.Fatalf("events %#v", events)
	}
	req.CodexThreadID = first.CodexThreadID
	req.CodexInstructionHash = first.CodexInstructionHash
	req.RunID = "run-two"
	if _, err := r.Run(context.Background(), req, nil); err != nil {
		t.Fatal(err)
	}
	if len(client.calls) != 4 || client.calls[0].method != "thread/start" || client.calls[2].method != "thread/resume" {
		t.Fatalf("calls %#v", client.calls)
	}
	firstPrompt, _ := json.Marshal(client.calls[1].params)
	secondPrompt, _ := json.Marshal(client.calls[3].params)
	if !strings.Contains(string(firstPrompt), "历史决定") || strings.Contains(string(secondPrompt), "历史决定") {
		t.Fatal("recap must only be sent when rebuilding a thread")
	}
	config1, _ := json.Marshal(client.calls[0].params["config"])
	config2, _ := json.Marshal(client.calls[2].params["config"])
	if !strings.Contains(string(config1), "run-one") || !strings.Contains(string(config2), "run-two") {
		t.Fatalf("MCP context was not refreshed: %s %s", config1, config2)
	}
}
func TestNativeRunnerHonorsTerminalStatus(t *testing.T) {
	for _, status := range []string{"failed", "interrupted"} {
		t.Run(status, func(t *testing.T) {
			c := newNativeClient()
			c.status = status
			r := nativeRunner(t, c)
			result, err := r.Run(context.Background(), AgentRunRequest{SessionID: "s"}, nil)
			if err == nil {
				t.Fatal("failed turn accepted")
			}
			if result.CodexThreadID == "" {
				t.Fatal("thread identity lost on interruption/failure")
			}
			if status == "interrupted" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		})
	}
}
func TestNativeRunnerOnlyRebuildsMissingThreads(t *testing.T) {
	for _, tt := range []struct {
		message string
		rebuild bool
	}{{"thread not found", true}, {"unauthorized", false}, {"connection unavailable", false}} {
		t.Run(tt.message, func(t *testing.T) {
			c := newNativeClient()
			r := nativeRunner(t, c)
			first, err := r.Run(context.Background(), AgentRunRequest{SessionID: "s"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			c.calls = nil
			c.resumeError = errors.New(tt.message)
			_, err = r.Run(context.Background(), AgentRunRequest{SessionID: "s", CodexThreadID: first.CodexThreadID, CodexInstructionHash: first.CodexInstructionHash}, nil)
			if tt.rebuild && err != nil {
				t.Fatal(err)
			}
			if !tt.rebuild && (err == nil || len(c.calls) != 1) {
				t.Fatalf("unexpected rebuild: %#v %v", c.calls, err)
			}
		})
	}
}
func TestNativeApprovalDoesNotBlockNotificationsAndAcceptsStructuredAnswers(t *testing.T) {
	c := newNativeClient()
	r := nativeRunner(t, c)
	published := make(chan AgentEvent, 8)
	a := newActiveTurn(c, AgentRunRequest{SessionID: "session"}, "thread", func(e AgentEvent) { published <- e })
	a.turnID = "turn"
	defer a.close()
	r.active["session"] = a
	m := nativeMessage("item/tool/requestUserInput", `{"threadId":"thread","turnId":"turn","itemId":"question","questions":[{"id":"language","header":"语言","question":"选用什么语言？","options":[{"label":"中文","description":"中文输出"}]}]}`)
	m.ID = json.RawMessage(`"request-1"`)
	if _, err := a.handle(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	var request AgentRuntimePermissionRequest
	select {
	case e := <-published:
		request = *e.Runtime.PermissionRequest
	case <-time.After(time.Second):
		t.Fatal("request not published")
	}
	if len(request.Questions) != 1 {
		t.Fatal("question missing")
	}
	if err := r.ResolveUserInput("other", request.RequestID, "accept", map[string][]string{"language": {"中文"}}, false); err == nil {
		t.Fatal("cross-session decision accepted")
	}
	if err := r.ResolveUserInput("session", request.RequestID, "accept", nil, false); err == nil {
		t.Fatal("missing required answer accepted")
	}
	if _, err := a.handle(context.Background(), nativeMessage("item/agentMessage/delta", `{"threadId":"thread","turnId":"turn","itemId":"comment","delta":"等待回答"}`)); err != nil {
		t.Fatal(err)
	}
	<-published
	if err := r.ResolveUserInput("session", request.RequestID, "accept", map[string][]string{"language": {"中文"}}, false); err != nil {
		t.Fatal(err)
	}
	select {
	case reply := <-c.replies:
		raw, _ := json.Marshal(reply.value)
		if !strings.Contains(string(raw), `"answers":{"language":{"answers":["中文"]}}`) {
			t.Fatalf("%s", raw)
		}
	case <-time.After(time.Second):
		t.Fatal("Codex not answered")
	}
	select {
	case e := <-published:
		if e.Runtime.Kind != "permissionResolved" {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("UI not resolved")
	}
}
func TestNativeApprovalCancellationRepliesAndClearsPending(t *testing.T) {
	c := newNativeClient()
	published := make(chan AgentEvent, 8)
	a := newActiveTurn(c, AgentRunRequest{SessionID: "s"}, "t", func(e AgentEvent) { published <- e })
	m := nativeMessage("item/commandExecution/requestApproval", `{"threadId":"t","command":"echo hello"}`)
	m.ID = json.RawMessage(`17`)
	_, _ = a.handle(context.Background(), m)
	<-published
	a.close()
	select {
	case reply := <-c.replies:
		raw, _ := json.Marshal(reply.value)
		if string(raw) != `{"decision":"cancel"}` {
			t.Fatal(string(raw))
		}
	case <-time.After(time.Second):
		t.Fatal("pending request not cancelled")
	}
	<-published
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.pending) != 0 {
		t.Fatal("pending request leaked")
	}
}
