package settings

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	codexAccountRequestTimeout = 20 * time.Second
	codexAccountLoginTimeout   = 10 * time.Minute
)

// CodexAccountStatus is the redacted global Codex account state.
type CodexAccountStatus struct {
	Status    string `json:"status"`
	Email     string `json:"email,omitempty"`
	PlanType  string `json:"planType,omitempty"`
	CodexHome string `json:"codexHome"`
	Shared    bool   `json:"shared"`
}

// CodexLoginAttempt is a browser-based ChatGPT login attempt.
type CodexLoginAttempt struct {
	LoginID string `json:"loginId"`
	AuthURL string `json:"authUrl,omitempty"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// CodexAccountManager manages global Codex account operations through app-server.
type CodexAccountManager struct {
	mu         sync.Mutex
	binPath    string
	attempts   map[string]CodexLoginAttempt
	pending    *codexPendingLogin
	newSession func(context.Context, string) (*codexAppServerSession, error)
}

type codexPendingLogin struct {
	attempt CodexLoginAttempt
	cancel  context.CancelFunc
	session *codexAppServerSession
}

// NewCodexAccountManager creates an account manager for a bundled Codex executable.
func NewCodexAccountManager(binPath string) *CodexAccountManager {
	return &CodexAccountManager{
		binPath:    strings.TrimSpace(binPath),
		attempts:   make(map[string]CodexLoginAttempt),
		newSession: startCodexAppServerSession,
	}
}

// GetCodexAccount returns the global Codex account without exposing credentials.
func (service *Settings) GetCodexAccount(ctx context.Context) (CodexAccountStatus, error) {
	if service.codexAccount == nil {
		return codexUnavailableStatus(), ErrCodexAccountUnavailable
	}
	return service.codexAccount.Account(ctx)
}

// BeginCodexLogin starts or reuses a browser-based ChatGPT login attempt.
func (service *Settings) BeginCodexLogin(ctx context.Context) (CodexLoginAttempt, error) {
	if service.codexAccount == nil {
		return CodexLoginAttempt{}, ErrCodexAccountUnavailable
	}
	return service.codexAccount.BeginLogin(ctx)
}

// GetCodexLogin returns one login attempt snapshot.
func (service *Settings) GetCodexLogin(_ context.Context, loginID string) (CodexLoginAttempt, error) {
	if service.codexAccount == nil {
		return CodexLoginAttempt{}, ErrCodexAccountUnavailable
	}
	return service.codexAccount.Login(loginID)
}

// CancelCodexLogin cancels one pending login attempt.
func (service *Settings) CancelCodexLogin(ctx context.Context, loginID string) (CodexLoginAttempt, error) {
	if service.codexAccount == nil {
		return CodexLoginAttempt{}, ErrCodexAccountUnavailable
	}
	return service.codexAccount.CancelLogin(ctx, loginID)
}

// LogoutCodexAccount clears the shared global Codex login state.
func (service *Settings) LogoutCodexAccount(ctx context.Context) (CodexAccountStatus, error) {
	if service.codexAccount == nil {
		return codexUnavailableStatus(), ErrCodexAccountUnavailable
	}
	if err := service.codexAccount.Logout(ctx); err != nil {
		return CodexAccountStatus{}, err
	}
	status, err := service.codexAccount.Account(ctx)
	if err != nil {
		return CodexAccountStatus{}, err
	}
	return status, nil
}

// Account reads the global Codex account through a short-lived app-server session.
func (manager *CodexAccountManager) Account(ctx context.Context) (CodexAccountStatus, error) {
	status := codexUnavailableStatus()
	if manager == nil || manager.binPath == "" {
		return status, ErrCodexAccountUnavailable
	}
	requestCtx, cancel := context.WithTimeout(ctx, codexAccountRequestTimeout)
	defer cancel()
	session, err := manager.newSession(requestCtx, manager.binPath)
	if err != nil {
		return status, fmt.Errorf("%w: starting account service", ErrCodexAccountUnavailable)
	}
	defer session.Close()

	var response struct {
		Account *struct {
			Type     string `json:"type"`
			Email    string `json:"email"`
			PlanType string `json:"planType"`
		} `json:"account"`
	}
	if err := session.Call(requestCtx, "account/read", map[string]any{"refreshToken": false}, &response); err != nil {
		return status, fmt.Errorf("reading Codex account: %w", err)
	}
	status.Status = "notLoggedIn"
	if response.Account != nil && response.Account.Type == "chatgpt" {
		status.Status = "loggedIn"
		status.Email = strings.TrimSpace(response.Account.Email)
		status.PlanType = strings.TrimSpace(response.Account.PlanType)
	}
	return status, nil
}

// BeginLogin starts the managed ChatGPT browser flow.
func (manager *CodexAccountManager) BeginLogin(ctx context.Context) (CodexLoginAttempt, error) {
	if manager == nil || manager.binPath == "" {
		return CodexLoginAttempt{}, ErrCodexAccountUnavailable
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.pending != nil {
		return manager.pending.attempt, nil
	}

	loginCtx, cancel := context.WithTimeout(context.Background(), codexAccountLoginTimeout)
	session, err := manager.newSession(loginCtx, manager.binPath)
	if err != nil {
		cancel()
		return CodexLoginAttempt{}, fmt.Errorf("%w: starting login service", ErrCodexAccountUnavailable)
	}
	var response struct {
		Type    string `json:"type"`
		LoginID string `json:"loginId"`
		AuthURL string `json:"authUrl"`
	}
	if err := session.Call(ctx, "account/login/start", map[string]any{
		"type":                      "chatgpt",
		"useHostedLoginSuccessPage": true,
		"appBrand":                  "codex",
	}, &response); err != nil {
		session.Close()
		cancel()
		return CodexLoginAttempt{}, fmt.Errorf("starting ChatGPT login: %w", err)
	}
	if response.Type != "chatgpt" || strings.TrimSpace(response.LoginID) == "" || !validCodexAuthURL(response.AuthURL) {
		session.Close()
		cancel()
		return CodexLoginAttempt{}, errors.New("Codex returned an invalid browser login response")
	}
	attempt := CodexLoginAttempt{
		LoginID: strings.TrimSpace(response.LoginID),
		AuthURL: strings.TrimSpace(response.AuthURL),
		Status:  "pending",
	}
	pending := &codexPendingLogin{attempt: attempt, cancel: cancel, session: session}
	manager.pending = pending
	manager.attempts[attempt.LoginID] = attempt
	go manager.watchLogin(loginCtx, pending)
	return attempt, nil
}

// Login returns a snapshot without exposing app-server internals.
func (manager *CodexAccountManager) Login(loginID string) (CodexLoginAttempt, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	attempt, ok := manager.attempts[strings.TrimSpace(loginID)]
	if !ok {
		return CodexLoginAttempt{}, ErrCodexLoginNotFound
	}
	return attempt, nil
}

// CancelLogin cancels a pending browser login.
func (manager *CodexAccountManager) CancelLogin(ctx context.Context, loginID string) (CodexLoginAttempt, error) {
	_ = ctx
	manager.mu.Lock()
	pending := manager.pending
	if pending == nil || pending.attempt.LoginID != strings.TrimSpace(loginID) {
		manager.mu.Unlock()
		return CodexLoginAttempt{}, ErrCodexLoginNotFound
	}
	manager.mu.Unlock()

	manager.finishLogin(pending, "canceled", "")
	return manager.Login(loginID)
}

// Logout signs out of the shared global Codex account.
func (manager *CodexAccountManager) Logout(ctx context.Context) error {
	if manager == nil || manager.binPath == "" {
		return ErrCodexAccountUnavailable
	}
	requestCtx, cancel := context.WithTimeout(ctx, codexAccountRequestTimeout)
	defer cancel()
	session, err := manager.newSession(requestCtx, manager.binPath)
	if err != nil {
		return fmt.Errorf("%w: starting account service", ErrCodexAccountUnavailable)
	}
	defer session.Close()
	var response map[string]any
	if err := session.Call(requestCtx, "account/logout", nil, &response); err != nil {
		return fmt.Errorf("logging out of Codex: %w", err)
	}
	return nil
}

func (manager *CodexAccountManager) watchLogin(ctx context.Context, pending *codexPendingLogin) {
	for {
		message, err := pending.session.Next(ctx)
		if err != nil {
			status := "failed"
			message := "Codex 登录未完成，请重试。"
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				status = "expired"
				message = "登录已超时，请重试。"
			}
			manager.finishLogin(pending, status, message)
			return
		}
		if message.Method != "account/login/completed" {
			continue
		}
		var completion struct {
			LoginID string `json:"loginId"`
			Success bool   `json:"success"`
			Error   string `json:"error"`
		}
		if json.Unmarshal(message.Params, &completion) != nil || completion.LoginID != pending.attempt.LoginID {
			continue
		}
		if completion.Success {
			manager.finishLogin(pending, "completed", "")
		} else {
			manager.finishLogin(pending, "failed", sanitizeCodexAccountError(completion.Error))
		}
		return
	}
}

func (manager *CodexAccountManager) finishLogin(pending *codexPendingLogin, status string, errorMessage string) {
	manager.mu.Lock()
	if manager.pending != pending {
		manager.mu.Unlock()
		return
	}
	attempt := pending.attempt
	attempt.Status = status
	attempt.Error = errorMessage
	manager.attempts[attempt.LoginID] = attempt
	manager.pending = nil
	manager.mu.Unlock()
	pending.cancel()
	pending.session.Close()
}

func codexUnavailableStatus() CodexAccountStatus {
	return CodexAccountStatus{Status: "unavailable", CodexHome: effectiveCodexHome(), Shared: true}
}

func effectiveCodexHome() string {
	if value := strings.TrimSpace(os.Getenv("CODEX_HOME")); value != "" {
		if absolute, err := filepath.Abs(value); err == nil {
			return absolute
		}
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "~/.codex"
	}
	return filepath.Join(home, ".codex")
}

func validCodexAuthURL(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://localhost:") || strings.HasPrefix(value, "http://127.0.0.1:")
}

func sanitizeCodexAccountError(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Codex 登录失败，请重试。"
	}
	if index := strings.Index(value, "http"); index >= 0 {
		value = strings.TrimSpace(value[:index])
	}
	if len(value) > 240 {
		value = value[:240]
	}
	return value
}

type codexAppServerSession struct {
	cancel context.CancelFunc
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	scan   *bufio.Scanner
	mu     sync.Mutex
	nextID int
}

type codexRPCMessage struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func startCodexAppServerSession(parent context.Context, binPath string) (*codexAppServerSession, error) {
	if strings.TrimSpace(binPath) == "" {
		return nil, ErrCodexAccountUnavailable
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
	session := &codexAppServerSession{cancel: cancel, cmd: cmd, stdin: stdin, scan: bufio.NewScanner(stdout)}
	if err := session.initialize(ctx); err != nil {
		session.Close()
		return nil, err
	}
	return session, nil
}

func (session *codexAppServerSession) initialize(ctx context.Context) error {
	var ignored map[string]any
	if err := session.Call(ctx, "initialize", map[string]any{
		"clientInfo": map[string]string{"name": "mediago-drama", "title": "MediaGo Drama", "version": "1"},
	}, &ignored); err != nil {
		return fmt.Errorf("initializing app-server: %w", err)
	}
	return session.write(map[string]any{"method": "initialized"})
}

func (session *codexAppServerSession) Call(ctx context.Context, method string, params any, output any) error {
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
		message, err := session.next(ctx)
		if err != nil {
			return err
		}
		var responseID int
		if len(message.ID) == 0 || json.Unmarshal(message.ID, &responseID) != nil || responseID != id {
			continue
		}
		if message.Error != nil {
			return fmt.Errorf("app-server request failed (%d): %s", message.Error.Code, sanitizeCodexAccountError(message.Error.Message))
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

func (session *codexAppServerSession) Next(ctx context.Context) (codexRPCMessage, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.next(ctx)
}

func (session *codexAppServerSession) next(ctx context.Context) (codexRPCMessage, error) {
	if err := ctx.Err(); err != nil {
		return codexRPCMessage{}, err
	}
	if !session.scan.Scan() {
		if err := session.scan.Err(); err != nil {
			return codexRPCMessage{}, fmt.Errorf("reading app-server response: %w", err)
		}
		if err := ctx.Err(); err != nil {
			return codexRPCMessage{}, err
		}
		return codexRPCMessage{}, io.EOF
	}
	var message codexRPCMessage
	if err := json.Unmarshal(session.scan.Bytes(), &message); err != nil {
		return codexRPCMessage{}, fmt.Errorf("decoding app-server message: %w", err)
	}
	return message, nil
}

func (session *codexAppServerSession) write(value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encoding app-server request: %w", err)
	}
	if _, err := session.stdin.Write(append(raw, '\n')); err != nil {
		return fmt.Errorf("writing app-server request: %w", err)
	}
	return nil
}

func (session *codexAppServerSession) Close() {
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
