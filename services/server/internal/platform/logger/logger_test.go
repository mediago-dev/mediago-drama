package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConfigureDefaultLoggerWritesFile(t *testing.T) {
	original := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(original)
	})

	logPath := filepath.Join(t.TempDir(), "server.log")
	resolvedPath, closeLog, err := ConfigureDefaultLogger(logPath)
	if err != nil {
		t.Fatalf("ConfigureDefaultLogger() error = %v", err)
	}
	if filepath.Dir(resolvedPath) != filepath.Dir(logPath) ||
		!strings.HasPrefix(filepath.Base(resolvedPath), "server-") ||
		filepath.Ext(resolvedPath) != ".log" {
		t.Fatalf("log path = %q, want dated log path next to %q", resolvedPath, logPath)
	}

	slog.Info("test log entry", "route", "/api/health")
	if err := closeLog(); err != nil {
		t.Fatalf("closing log: %v", err)
	}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		t.Fatalf("reading log file: %v", err)
	}
	body := string(content)
	if !strings.Contains(body, "test log entry") || !strings.Contains(body, "/api/health") {
		t.Fatalf("log file = %q, want message and route", body)
	}
	if strings.Contains(body, "\x1b[") {
		t.Fatalf("log file = %q, should not contain console color codes", body)
	}
	var payload map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(content), &payload); err != nil {
		t.Fatalf("log file should be JSONL: %v\n%s", err, body)
	}
}

func TestPrettyHandlerFormatsHTTPRequestErrors(t *testing.T) {
	var output bytes.Buffer
	handler := newPrettyHandler(&output, prettyHandlerOptions{Level: slog.LevelDebug})
	record := slog.NewRecord(time.Date(2026, 6, 10, 5, 8, 12, 441_000_000, time.UTC), slog.LevelWarn, "http request", 0)
	record.AddAttrs(
		slog.String("method", "POST"),
		slog.String("path", "/api/v1/internal/agent/document-mcp"),
		slog.Int("status", 404),
		slog.Int("duration_ms", 0),
		slog.String("client_ip", "127.0.0.1"),
		slog.String("request_id", "req-test"),
		slog.String("error", "api route not found"),
	)

	if err := handler.Handle(context.Background(), record); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	value := output.String()
	for _, fragment := range []string{
		"05:08:12.441",
		"WARN",
		"404",
		"POST",
		"/api/v1/internal/agent/document-mcp",
		"api route not found",
		"request_id=req-test",
	} {
		if !strings.Contains(value, fragment) {
			t.Fatalf("pretty log = %q, want fragment %q", value, fragment)
		}
	}
}

func TestDailyFileWriterRotatesByDate(t *testing.T) {
	now := time.Date(2026, 6, 10, 5, 0, 0, 0, time.Local)
	basePath := filepath.Join(t.TempDir(), "server.log")
	writer, err := newDailyFileWriter(basePath, func() time.Time {
		return now
	})
	if err != nil {
		t.Fatalf("newDailyFileWriter() error = %v", err)
	}

	if _, err := writer.Write([]byte("first\n")); err != nil {
		t.Fatalf("first write: %v", err)
	}
	now = now.Add(24 * time.Hour)
	if _, err := writer.Write([]byte("second\n")); err != nil {
		t.Fatalf("second write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	first, err := os.ReadFile(datedLogPath(basePath, "2026-06-10"))
	if err != nil {
		t.Fatalf("reading first log: %v", err)
	}
	second, err := os.ReadFile(datedLogPath(basePath, "2026-06-11"))
	if err != nil {
		t.Fatalf("reading second log: %v", err)
	}
	if string(first) != "first\n" || string(second) != "second\n" {
		t.Fatalf("rotated logs = %q / %q, want split entries", first, second)
	}
}

func TestConfiguredLogLevelUsesExplicitValueBeforeEnvironment(t *testing.T) {
	t.Setenv("MEDIAGO_LOG_LEVEL", "debug")

	if level := ConfiguredLogLevel("warn"); level != slog.LevelWarn {
		t.Fatalf("level = %v, want warn", level)
	}
}

func TestConfiguredLogLevelFallsBackToEnvironment(t *testing.T) {
	t.Setenv("MEDIAGO_LOG_LEVEL", "debug")

	if level := ConfiguredLogLevel(""); level != slog.LevelDebug {
		t.Fatalf("level = %v, want debug", level)
	}
}

func TestConfiguredLogLevelDefaultsToInfo(t *testing.T) {
	t.Setenv("MEDIAGO_LOG_LEVEL", "unknown")

	if level := ConfiguredLogLevel(""); level != slog.LevelInfo {
		t.Fatalf("level = %v, want info", level)
	}
}
