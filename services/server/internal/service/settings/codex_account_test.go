package settings

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestCodexAccountReadsSharedChatGPTLogin(t *testing.T) {
	binPath := writeFakeCodexAppServer(t)
	t.Setenv("FAKE_CODEX_ACCOUNT_MODE", "logged-in")
	t.Setenv("CODEX_HOME", filepath.Join(t.TempDir(), "shared-codex"))
	service := NewSettings(nil)
	service.SetCodexCLIPath(binPath)

	status, err := service.GetCodexAccount(context.Background())
	if err != nil {
		t.Fatalf("GetCodexAccount() error = %v", err)
	}
	if status.Status != "loggedIn" || status.Email != "user@example.com" || status.PlanType != "plus" {
		t.Fatalf("GetCodexAccount() = %#v", status)
	}
	if status.CodexHome != os.Getenv("CODEX_HOME") || !status.Shared {
		t.Fatalf("shared account metadata = %#v", status)
	}
}

func TestCodexAccountReportsMissingLogin(t *testing.T) {
	binPath := writeFakeCodexAppServer(t)
	t.Setenv("FAKE_CODEX_ACCOUNT_MODE", "logged-out")
	service := NewSettings(nil)
	service.SetCodexCLIPath(binPath)

	status, err := service.GetCodexAccount(context.Background())
	if err != nil {
		t.Fatalf("GetCodexAccount() error = %v", err)
	}
	if status.Status != "notLoggedIn" || status.Email != "" || status.PlanType != "" {
		t.Fatalf("GetCodexAccount() = %#v", status)
	}
}

func TestCodexAccountBrowserLoginCompletes(t *testing.T) {
	binPath := writeFakeCodexAppServer(t)
	t.Setenv("FAKE_CODEX_ACCOUNT_MODE", "login-success")
	service := NewSettings(nil)
	service.SetCodexCLIPath(binPath)

	attempt, err := service.BeginCodexLogin(context.Background())
	if err != nil {
		t.Fatalf("BeginCodexLogin() error = %v", err)
	}
	if attempt.LoginID != "login-123" || attempt.Status != "pending" || attempt.AuthURL != "https://chatgpt.com/auth/test" {
		t.Fatalf("BeginCodexLogin() = %#v", attempt)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		attempt, err = service.GetCodexLogin(context.Background(), attempt.LoginID)
		if err != nil {
			t.Fatalf("GetCodexLogin() error = %v", err)
		}
		if attempt.Status == "completed" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("login did not complete: %#v", attempt)
}

func TestCodexAccountBrowserLoginCanBeCanceled(t *testing.T) {
	binPath := writeFakeCodexAppServer(t)
	t.Setenv("FAKE_CODEX_ACCOUNT_MODE", "login-pending")
	service := NewSettings(nil)
	service.SetCodexCLIPath(binPath)

	attempt, err := service.BeginCodexLogin(context.Background())
	if err != nil {
		t.Fatalf("BeginCodexLogin() error = %v", err)
	}
	duplicate, err := service.BeginCodexLogin(context.Background())
	if err != nil {
		t.Fatalf("duplicate BeginCodexLogin() error = %v", err)
	}
	if duplicate.LoginID != attempt.LoginID {
		t.Fatalf("duplicate login = %#v, want login id %q", duplicate, attempt.LoginID)
	}

	canceled, err := service.CancelCodexLogin(context.Background(), attempt.LoginID)
	if err != nil {
		t.Fatalf("CancelCodexLogin() error = %v", err)
	}
	if canceled.Status != "canceled" {
		t.Fatalf("CancelCodexLogin() = %#v", canceled)
	}
}

func TestCodexAccountRejectsUnavailableExecutable(t *testing.T) {
	service := NewSettings(nil)
	service.SetCodexCLIPath("")
	if _, err := service.GetCodexAccount(context.Background()); !errorsIs(err, ErrCodexAccountUnavailable) {
		t.Fatalf("GetCodexAccount() error = %v, want ErrCodexAccountUnavailable", err)
	}
}

func errorsIs(err error, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		value, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = value.Unwrap()
	}
	return false
}

func writeFakeCodexAppServer(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake app-server fixture uses a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), "codex")
	script := `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      echo '{"id":1,"result":{"userAgent":"fake"}}'
      ;;
    *'"method":"account/read"'*)
      if [ "$FAKE_CODEX_ACCOUNT_MODE" = "logged-in" ]; then
        echo '{"id":2,"result":{"account":{"type":"chatgpt","email":"user@example.com","planType":"plus"},"requiresOpenaiAuth":true}}'
      else
        echo '{"id":2,"result":{"account":null,"requiresOpenaiAuth":true}}'
      fi
      ;;
    *'"method":"account/login/start"'*)
      echo '{"id":2,"result":{"type":"chatgpt","loginId":"login-123","authUrl":"https://chatgpt.com/auth/test"}}'
      if [ "$FAKE_CODEX_ACCOUNT_MODE" = "login-success" ]; then
        echo '{"method":"account/login/completed","params":{"loginId":"login-123","success":true,"error":null}}'
      fi
      ;;
    *'"method":"account/logout"'*)
      echo '{"id":2,"result":{}}'
      ;;
  esac
done
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile(fake codex) error = %v", err)
	}
	return path
}
