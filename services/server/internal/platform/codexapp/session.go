// Package codexapp provides a small JSON-RPC client for the bundled Codex app-server.
package codexapp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// Message is one response or notification emitted by Codex app-server.
type Message struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// RPCError is the public error shape returned by Codex app-server.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Client is the app-server surface consumed by higher-level services.
type Client interface {
	Call(context.Context, string, any, any) error
	Next(context.Context) (Message, error)
	Close()
}

// Session owns one stdio Codex app-server process.
type Session struct {
	cancel  context.CancelFunc
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	scan    *bufio.Scanner
	mu      sync.Mutex
	nextID  int
	pending []Message
}

// Start launches and initializes a Codex app-server session.
func Start(parent context.Context, binPath string) (*Session, error) {
	if strings.TrimSpace(binPath) == "" {
		return nil, fmt.Errorf("Codex executable is required")
	}
	ctx, cancel := context.WithCancel(parent)
	cmd := exec.CommandContext(ctx, binPath, "app-server", "--stdio")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("opening app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("opening app-server stdout: %w", err)
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("starting app-server: %w", err)
	}
	session := &Session{cancel: cancel, cmd: cmd, stdin: stdin, scan: bufio.NewScanner(stdout)}
	if err := session.initialize(ctx); err != nil {
		session.Close()
		return nil, err
	}
	return session, nil
}

func (session *Session) initialize(ctx context.Context) error {
	var ignored map[string]any
	if err := session.Call(ctx, "initialize", map[string]any{
		"clientInfo": map[string]string{"name": "mediago-drama", "title": "MediaGo Drama", "version": "1"},
	}, &ignored); err != nil {
		return fmt.Errorf("initializing app-server: %w", err)
	}
	return session.write(map[string]any{"method": "initialized"})
}

// Call sends one request and waits for its matching response.
func (session *Session) Call(ctx context.Context, method string, params any, output any) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	session.nextID++
	id := session.nextID
	request := map[string]any{"id": id, "method": method}
	if params != nil {
		request["params"] = params
	}
	if err := session.write(request); err != nil {
		return err
	}
	for {
		message, err := session.read(ctx)
		if err != nil {
			return err
		}
		var responseID int
		if len(message.ID) == 0 || json.Unmarshal(message.ID, &responseID) != nil || responseID != id {
			session.pending = append(session.pending, message)
			continue
		}
		if message.Error != nil {
			return fmt.Errorf("app-server request failed (%d): %s", message.Error.Code, safeRPCMessage(message.Error.Message))
		}
		if output == nil || len(message.Result) == 0 {
			return nil
		}
		if err := json.Unmarshal(message.Result, output); err != nil {
			return fmt.Errorf("decoding app-server response: %w", err)
		}
		return nil
	}
}

func safeRPCMessage(value string) string {
	value = strings.TrimSpace(value)
	if index := strings.Index(strings.ToLower(value), "http"); index >= 0 {
		value = strings.TrimSpace(value[:index])
	}
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "request failed"
	}
	if len(value) > 240 {
		return value[:240]
	}
	return value
}

// Next returns the next queued or newly received app-server message.
func (session *Session) Next(ctx context.Context) (Message, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	if len(session.pending) > 0 {
		message := session.pending[0]
		session.pending = session.pending[1:]
		return message, nil
	}
	return session.read(ctx)
}

func (session *Session) read(ctx context.Context) (Message, error) {
	if err := ctx.Err(); err != nil {
		return Message{}, err
	}
	if !session.scan.Scan() {
		if err := session.scan.Err(); err != nil {
			return Message{}, fmt.Errorf("reading app-server response: %w", err)
		}
		if err := ctx.Err(); err != nil {
			return Message{}, err
		}
		return Message{}, io.EOF
	}
	var message Message
	if err := json.Unmarshal(session.scan.Bytes(), &message); err != nil {
		return Message{}, fmt.Errorf("decoding app-server message: %w", err)
	}
	return message, nil
}

func (session *Session) write(value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encoding app-server request: %w", err)
	}
	if _, err := session.stdin.Write(append(raw, '\n')); err != nil {
		return fmt.Errorf("writing app-server request: %w", err)
	}
	return nil
}

// Close stops the app-server process and releases its pipes.
func (session *Session) Close() {
	if session == nil {
		return
	}
	session.cancel()
	_ = session.stdin.Close()
	if session.cmd != nil && session.cmd.Process != nil {
		_ = session.cmd.Process.Kill()
	}
	if session.cmd != nil {
		_ = session.cmd.Wait()
	}
}
