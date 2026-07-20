package codexapp

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSessionInitializesCallsAndQueuesNotifications(t *testing.T) {
	binPath := writeFakeAppServer(t, `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      echo '{"id":1,"result":{"userAgent":"fake"}}'
      ;;
    *'"method":"test/call"'*)
      echo '{"method":"test/notification","params":{"value":"queued"}}'
      echo '{"id":2,"result":{"value":"done"}}'
      ;;
  esac
done
`)

	session, err := Start(context.Background(), binPath)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer session.Close()

	var response struct {
		Value string `json:"value"`
	}
	if err := session.Call(context.Background(), "test/call", map[string]string{"input": "ok"}, &response); err != nil {
		t.Fatalf("Call() error = %v", err)
	}
	if response.Value != "done" {
		t.Fatalf("Call() response = %#v", response)
	}
	message, err := session.Next(context.Background())
	if err != nil {
		t.Fatalf("Next() error = %v", err)
	}
	if message.Method != "test/notification" || !strings.Contains(string(message.Params), "queued") {
		t.Fatalf("Next() = %#v", message)
	}
}

func TestSessionReturnsRPCError(t *testing.T) {
	binPath := writeFakeAppServer(t, `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) echo '{"id":1,"result":{}}' ;;
    *'"method":"test/fail"'*) echo '{"id":2,"error":{"code":-32000,"message":"request failed"}}' ;;
  esac
done
`)
	session, err := Start(context.Background(), binPath)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer session.Close()

	err = session.Call(context.Background(), "test/fail", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "request failed") {
		t.Fatalf("Call() error = %v", err)
	}
}

func writeFakeAppServer(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake app-server fixture uses a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}
