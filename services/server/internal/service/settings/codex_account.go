package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
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
	newSession func(context.Context, string) (codexapp.Client, error)
}

type codexPendingLogin struct {
	attempt CodexLoginAttempt
	cancel  context.CancelFunc
	session codexapp.Client
}

// NewCodexAccountManager creates an account manager for a bundled Codex executable.
func NewCodexAccountManager(binPath string) *CodexAccountManager {
	return &CodexAccountManager{
		binPath:  strings.TrimSpace(binPath),
		attempts: make(map[string]CodexLoginAttempt),
		newSession: func(ctx context.Context, binPath string) (codexapp.Client, error) {
			return codexapp.Start(ctx, binPath)
		},
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
