// Package codexapp provides the bidirectional stdio transport for Codex app-server.
package codexapp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Message is a response, notification, or server-initiated request.
type Message struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// RPCError is an app-server protocol error.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Client is the transport surface consumed by higher-level services.
type Client interface {
	Call(context.Context, string, any, any) error
	Next(context.Context) (Message, error)
	Close()
}

// Responder answers server-initiated requests such as approval prompts.
type Responder interface {
	Respond(context.Context, json.RawMessage, any, *RPCError) error
}

// Options configures one isolated app-server process.
type Options struct {
	Directory string
	Env       map[string]string
	Args      []string
	Stderr    io.Writer
}

// Session multiplexes requests and events with a single stdout reader.
type Session struct {
	cancel     context.CancelFunc
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     io.ReadCloser
	writeMu    sync.Mutex
	mu         sync.Mutex
	nextID     int
	pending    map[string]chan Message
	queue      []Message
	wake       chan struct{}
	done       chan struct{}
	err        error
	finishOnce sync.Once
	closeOnce  sync.Once
}

// Start launches the app-server using the caller's isolated runtime configuration.
func Start(ctx context.Context, binPath string) (*Session, error) {
	return StartWithOptions(ctx, binPath, Options{})
}

// StartWithOptions launches and initializes a configured app-server process.
func StartWithOptions(parent context.Context, binPath string, options Options) (*Session, error) {
	if strings.TrimSpace(binPath) == "" {
		return nil, errors.New("Codex executable is required")
	}
	ctx, cancel := context.WithCancel(parent)
	args := append([]string{"app-server", "--listen", "stdio://", "-c", `cli_auth_credentials_store="file"`}, options.Args...)
	cmd := exec.CommandContext(ctx, binPath, args...)
	cmd.Dir = options.Directory
	configureProcess(cmd)
	env := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			env[key] = value
		}
	}
	delete(env, "CODEX_CONFIG")
	delete(env, "OPENAI_API_KEY")
	delete(env, "OPENAI_BASE_URL")
	for key, value := range options.Env {
		if value == "" {
			delete(env, key)
		} else {
			env[key] = value
		}
	}
	for key, value := range env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("opening app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		_ = stdin.Close()
		return nil, fmt.Errorf("opening app-server stdout: %w", err)
	}
	cmd.Stderr = options.Stderr
	if cmd.Stderr == nil {
		cmd.Stderr = io.Discard
	}
	if err := cmd.Start(); err != nil {
		cancel()
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("starting app-server: %w", err)
	}
	session := newSession(stdin, stdout)
	session.cancel = cancel
	session.cmd = cmd
	initializeCtx, initializeCancel := context.WithTimeout(ctx, 20*time.Second)
	defer initializeCancel()
	if err := session.initialize(initializeCtx); err != nil {
		session.Close()
		return nil, err
	}
	return session, nil
}
func newSession(stdin io.WriteCloser, stdout io.ReadCloser) *Session {
	s := &Session{stdin: stdin, stdout: stdout, pending: map[string]chan Message{}, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go s.readLoop()
	return s
}
func (s *Session) initialize(ctx context.Context) error {
	var result json.RawMessage
	if err := s.Call(ctx, "initialize", map[string]any{"capabilities": map[string]bool{"experimentalApi": true}, "clientInfo": map[string]string{"name": "mediago_drama_oss", "title": "MediaGo Drama OSS", "version": "1"}}, &result); err != nil {
		return fmt.Errorf("initializing app-server: %w", err)
	}
	return s.writeContext(ctx, map[string]any{"method": "initialized", "params": map[string]any{}})
}
func (s *Session) readLoop() {
	scan := bufio.NewScanner(s.stdout)
	scan.Buffer(make([]byte, 64*1024), 32*1024*1024)
	for scan.Scan() {
		var message Message
		if err := json.Unmarshal(scan.Bytes(), &message); err != nil {
			s.finish(fmt.Errorf("decoding app-server message: %w", err))
			return
		}
		s.mu.Lock()
		if message.Method == "" && len(message.ID) > 0 {
			response := s.pending[string(message.ID)]
			s.mu.Unlock()
			if response != nil {
				select {
				case response <- message:
				default:
				}
			}
			continue
		}
		if len(s.queue) >= 16384 {
			s.mu.Unlock()
			s.finish(errors.New("app-server event queue overflow"))
			return
		}
		s.queue = append(s.queue, message)
		s.mu.Unlock()
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
	err := scan.Err()
	if err == nil {
		err = io.EOF
	}
	s.finish(err)
}
func (s *Session) finish(err error) {
	s.finishOnce.Do(func() { s.mu.Lock(); s.err = err; s.mu.Unlock(); close(s.done) })
}

// Call sends a request without blocking event reads or other concurrent requests.
func (s *Session) Call(ctx context.Context, method string, params any, output any) error {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	key := strconv.Itoa(id)
	reply := make(chan Message, 1)
	s.pending[key] = reply
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, key); s.mu.Unlock() }()
	writeErr := s.writeContext(ctx, map[string]any{"id": id, "method": method, "params": params})
	var message Message
	if writeErr != nil {
		select {
		case message = <-reply:
			return decodeResponse(message, output)
		default:
			return writeErr
		}
	}
	select {
	case message = <-reply:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		select {
		case message = <-reply:
		default:
			s.mu.Lock()
			err := s.err
			s.mu.Unlock()
			return fmt.Errorf("app-server closed: %w", err)
		}
	}
	return decodeResponse(message, output)
}
func decodeResponse(message Message, output any) error {
	if message.Error != nil {
		return fmt.Errorf("app-server request failed (%d): %s", message.Error.Code, safeRPCMessage(message.Error.Message))
	}
	if output != nil && len(message.Result) > 0 {
		if err := json.Unmarshal(message.Result, output); err != nil {
			return fmt.Errorf("decoding app-server response: %w", err)
		}
	}
	return nil
}

// Next returns the next notification or server request. Cancellation interrupts waiting.
func (s *Session) Next(ctx context.Context) (Message, error) {
	for {
		if err := ctx.Err(); err != nil {
			return Message{}, err
		}
		s.mu.Lock()
		if len(s.queue) > 0 {
			m := s.queue[0]
			s.queue[0] = Message{}
			s.queue = s.queue[1:]
			s.mu.Unlock()
			return m, nil
		}
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return Message{}, ctx.Err()
		case <-s.wake:
		case <-s.done:
			s.mu.Lock()
			err := s.err
			queued := len(s.queue) > 0
			s.mu.Unlock()
			if queued {
				continue
			}
			return Message{}, err
		}
	}
}

// Respond preserves the server's request id and writes its result or error.
func (s *Session) Respond(ctx context.Context, id json.RawMessage, result any, rpcError *RPCError) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(id) == 0 {
		return errors.New("server request id is required")
	}
	reply := map[string]any{"id": id}
	if rpcError != nil {
		reply["error"] = rpcError
	} else {
		reply["result"] = result
	}
	return s.writeContext(ctx, reply)
}
func (s *Session) writeContext(ctx context.Context, value any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- s.write(value) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		s.Close()
		return ctx.Err()
	case <-s.done:
		return io.EOF
	}
}
func (s *Session) write(value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encoding app-server request: %w", err)
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write(append(raw, '\n'))
	if err != nil {
		return fmt.Errorf("writing app-server request: %w", err)
	}
	return nil
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

// Close terminates the process tree and releases transport resources exactly once.
func (s *Session) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		if s.cancel != nil {
			defer s.cancel()
		}
		_ = s.stdin.Close()
		_ = s.stdout.Close()
		s.finish(io.EOF)
		if s.cmd == nil {
			return
		}
		_ = stopProcess(s.cmd)
		_ = s.cmd.Wait()
	})
}
