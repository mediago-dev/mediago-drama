package codexapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func pipeSession(t *testing.T) (*Session, *json.Decoder, *json.Encoder) {
	t.Helper()
	serverIn, clientIn := io.Pipe()
	clientOut, serverOut := io.Pipe()
	s := newSession(clientIn, clientOut)
	t.Cleanup(func() { s.Close(); _ = serverIn.Close(); _ = serverOut.Close() })
	return s, json.NewDecoder(serverIn), json.NewEncoder(serverOut)
}
func TestTransportRoutesApprovalWhileCallWaits(t *testing.T) {
	s, in, out := pipeSession(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	serverErr := make(chan error, 1)
	go func() {
		var request Message
		if err := in.Decode(&request); err != nil {
			serverErr <- err
			return
		}
		_ = out.Encode(map[string]any{"id": request.ID, "method": "item/commandExecution/requestApproval", "params": map[string]string{"command": "test"}})
		var answer Message
		if err := in.Decode(&answer); err != nil {
			serverErr <- err
			return
		}
		if string(answer.ID) != string(request.ID) || !strings.Contains(string(answer.Result), "accept") {
			serverErr <- errors.New("incorrect server-request response")
			return
		}
		serverErr <- out.Encode(map[string]any{"id": request.ID, "result": map[string]string{"value": "done"}})
	}()
	result := make(chan error, 1)
	go func() {
		var response struct{ Value string }
		err := s.Call(ctx, "turn/start", nil, &response)
		if err == nil && response.Value != "done" {
			err = errors.New("wrong RPC result")
		}
		result <- err
	}()
	request, err := s.Next(ctx)
	if err != nil || request.Method != "item/commandExecution/requestApproval" {
		t.Fatalf("approval = %#v, %v", request, err)
	}
	if err := s.Respond(ctx, request.ID, map[string]string{"decision": "accept"}, nil); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := <-serverErr; err != nil {
		t.Fatal(err)
	}
}
func TestTransportSupportsLargeEventsAndCancelledReads(t *testing.T) {
	s, _, out := pipeSession(t)
	text := strings.Repeat("x", 256*1024)
	go func() {
		_ = out.Encode(map[string]any{"method": "large/event", "params": map[string]string{"text": text}})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	event, err := s.Next(ctx)
	if err != nil || !strings.Contains(string(event.Params), text) {
		t.Fatalf("large event lost: %v", err)
	}
	cancelled, stop := context.WithCancel(context.Background())
	stop()
	if _, err := s.Next(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled read = %v", err)
	}
}
func TestConcurrentCallsMatchOutOfOrderResponses(t *testing.T) {
	s, in, out := pipeSession(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	go func() {
		var first, second Message
		_ = in.Decode(&first)
		_ = in.Decode(&second)
		_ = out.Encode(map[string]any{"id": second.ID, "result": second.Method})
		_ = out.Encode(map[string]any{"id": first.ID, "result": first.Method})
	}()
	results := make(chan error, 2)
	for _, method := range []string{"first", "second"} {
		go func() {
			var response string
			err := s.Call(ctx, method, nil, &response)
			if err == nil && response != method {
				err = errors.New("response matched the wrong call")
			}
			results <- err
		}()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestTransportDrainsResponseAndEventsBeforeEOF(t *testing.T) {
	for i := 0; i < 30; i++ {
		input, writer := io.Pipe()
		reader, output := io.Pipe()
		s := newSession(writer, reader)
		go func() {
			defer input.Close()
			var req Message
			_ = json.NewDecoder(input).Decode(&req)
			enc := json.NewEncoder(output)
			_ = enc.Encode(map[string]any{"id": req.ID, "result": map[string]string{"value": "done"}})
			_ = enc.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{}})
			_ = output.Close()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		var result struct{ Value string }
		if err := s.Call(ctx, "test", nil, &result); err != nil {
			t.Fatal(err)
		}
		if result.Value != "done" {
			t.Fatal(result)
		}
		if event, err := s.Next(ctx); err != nil || event.Method != "turn/completed" {
			t.Fatalf("%#v %v", event, err)
		}
		s.Close()
		cancel()
	}
}
func TestTransportCancelsBlockedWrites(t *testing.T) {
	input, writer := io.Pipe()
	reader, output := io.Pipe()
	defer input.Close()
	defer output.Close()
	s := newSession(writer, reader)
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := s.Call(ctx, "unread-request", map[string]string{"text": strings.Repeat("x", 256*1024)}, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked write error=%v", err)
	}
}
