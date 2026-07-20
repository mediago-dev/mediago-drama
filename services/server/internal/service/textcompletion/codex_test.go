package textcompletion

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
)

type fakeCodexClient struct {
	calls    []string
	params   []map[string]any
	messages []codexapp.Message
	callErr  error
}

func (client *fakeCodexClient) Call(_ context.Context, method string, params any, output any) error {
	client.calls = append(client.calls, method)
	if values, ok := params.(map[string]any); ok {
		client.params = append(client.params, values)
	}
	if client.callErr != nil {
		return client.callErr
	}
	var raw string
	switch method {
	case "thread/start":
		raw = `{"thread":{"id":"thread-1"},"model":"gpt-codex"}`
	case "turn/start":
		raw = `{"turn":{"id":"turn-1"}}`
	}
	return json.Unmarshal([]byte(raw), output)
}

func (client *fakeCodexClient) Next(context.Context) (codexapp.Message, error) {
	if len(client.messages) == 0 {
		return codexapp.Message{}, errors.New("no messages")
	}
	message := client.messages[0]
	client.messages = client.messages[1:]
	return message, nil
}

func (client *fakeCodexClient) Close() {}

func TestCodexBackendCompletesEphemeralTextTurn(t *testing.T) {
	client := &fakeCodexClient{messages: []codexapp.Message{
		message("item/agentMessage/delta", `{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","delta":"partial"}`),
		message("item/completed", `{"threadId":"thread-1","turnId":"turn-1","completedAtMs":1,"item":{"id":"item-1","type":"agentMessage","phase":"final_answer","text":"optimized prompt"}}`),
		message("turn/completed", `{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}`),
	}}
	backend := NewCodexBackend("/fake/codex", "/workspace")
	backend.sessionFactory = func(context.Context, string) (codexapp.Client, error) { return client, nil }

	result, err := backend.Complete(context.Background(), Request{
		Prompt:            "rewrite this",
		SystemInstruction: "return only the result",
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if result.Text != "optimized prompt" || result.Executor != ExecutorCodex || result.Model != "gpt-codex" {
		t.Fatalf("Complete() = %#v", result)
	}
	if !reflect.DeepEqual(client.calls, []string{"thread/start", "turn/start"}) {
		t.Fatalf("calls = %#v", client.calls)
	}
	threadParams := client.params[0]
	if threadParams["ephemeral"] != true || threadParams["sandbox"] != "read-only" || threadParams["approvalPolicy"] != "never" {
		t.Fatalf("thread params = %#v", threadParams)
	}
	instructions, _ := threadParams["developerInstructions"].(string)
	if !strings.Contains(instructions, "Do not inspect files") || !strings.Contains(instructions, "return only the result") {
		t.Fatalf("developerInstructions = %q", instructions)
	}
}

func TestCodexBackendReportsFailedTurn(t *testing.T) {
	client := &fakeCodexClient{messages: []codexapp.Message{
		message("turn/completed", `{"threadId":"thread-1","turn":{"id":"turn-1","status":"failed","items":[],"error":{"message":"login required"}}}`),
	}}
	backend := NewCodexBackend("/fake/codex", "")
	backend.sessionFactory = func(context.Context, string) (codexapp.Client, error) { return client, nil }

	_, err := backend.Complete(context.Background(), Request{Prompt: "rewrite"})
	if err == nil || !strings.Contains(err.Error(), "login required") {
		t.Fatalf("Complete() error = %v", err)
	}
}

func TestCodexBackendRequiresExecutable(t *testing.T) {
	_, err := NewCodexBackend("", "").Complete(context.Background(), Request{Prompt: "rewrite"})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Complete() error = %v, want ErrUnavailable", err)
	}
}

func message(method string, params string) codexapp.Message {
	return codexapp.Message{Method: method, Params: json.RawMessage(params)}
}
