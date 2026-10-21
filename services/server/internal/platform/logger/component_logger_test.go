package logger

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewComponentLoggerWritesDebugToFileAndForwardsByGlobalLevel(t *testing.T) {
	previous := slog.Default()
	defer slog.SetDefault(previous)

	var forwarded bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&forwarded, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	logPath := filepath.Join(t.TempDir(), "runtime.log")
	logger, currentPath, closeLog, err := NewComponentLogger("runtime", logPath)
	if err != nil {
		t.Fatalf("NewComponentLogger: %v", err)
	}

	logger.Debug("runtime session update", "session_id", "session-1")
	logger.Info("runtime prompt completed", "duration_ms", 1280)
	if err := closeLog(); err != nil {
		t.Fatalf("closing component log: %v", err)
	}

	body, err := os.ReadFile(currentPath)
	if err != nil {
		t.Fatalf("reading component log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	if len(lines) != 2 {
		t.Fatalf("component log lines = %d, want 2; body = %s", len(lines), body)
	}
	for _, line := range lines {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("component log line %q is not JSON: %v", line, err)
		}
		if record["component"] != "runtime" {
			t.Fatalf("component log line %q missing component=runtime", line)
		}
	}
	if !strings.Contains(lines[0], "runtime session update") {
		t.Fatalf("file line %q, want the debug record first", lines[0])
	}

	if strings.Contains(forwarded.String(), "runtime session update") {
		t.Fatalf("forwarded output %q, want debug record filtered by global level", forwarded.String())
	}
	if !strings.Contains(forwarded.String(), "runtime prompt completed") {
		t.Fatalf("forwarded output %q, want info record forwarded", forwarded.String())
	}
}
