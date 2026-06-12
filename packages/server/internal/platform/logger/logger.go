// Package logger configures process-wide structured logging for the server.
package logger

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

const (
	ansiReset   = "\x1b[0m"
	ansiDim     = "\x1b[2m"
	ansiCyan    = "\x1b[36m"
	ansiGreen   = "\x1b[32m"
	ansiBlue    = "\x1b[34m"
	ansiMagenta = "\x1b[35m"
	ansiYellow  = "\x1b[33m"
	ansiRed     = "\x1b[31m"
)

// ConfigureDefaultLogger configures the process-wide slog default logger.
func ConfigureDefaultLogger(logPath string, levelValues ...string) (string, func() error, error) {
	if strings.TrimSpace(logPath) == "" {
		logPath = DefaultLogPath()
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return "", nil, fmt.Errorf("creating log directory: %w", err)
	}

	file, err := newDailyFileWriter(logPath, timeNow)
	if err != nil {
		return "", nil, fmt.Errorf("opening log file: %w", err)
	}

	level := ConfiguredLogLevel(levelValues...)
	logger := slog.New(newTeeHandler(
		newPrettyHandler(os.Stderr, prettyHandlerOptions{
			Level: level,
			Color: colorConsoleEnabled(),
		}),
		slog.NewJSONHandler(file, &slog.HandlerOptions{Level: level}),
	))
	slog.SetDefault(logger)

	return file.CurrentPath(), file.Close, nil
}

// ConfiguredLogLevel returns the process-wide slog level.
func ConfiguredLogLevel(levelValues ...string) slog.Level {
	for _, value := range append(levelValues, os.Getenv("MEDIAGO_LOG_LEVEL")) {
		if level, ok := parseLogLevel(value); ok {
			return level
		}
	}
	return slog.LevelInfo
}

func parseLogLevel(value string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn", "warning":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	default:
		return slog.LevelInfo, false
	}
}

// DefaultLogPath returns the conventional local server log path.
func DefaultLogPath() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		return filepath.Join(configDir, "mediago-drama", "logs", "server.log")
	}

	homeDir, err := os.UserHomeDir()
	if err == nil && homeDir != "" {
		return filepath.Join(homeDir, ".mediago-drama", "logs", "server.log")
	}

	return filepath.Join(".", ".mediago-drama", "logs", "server.log")
}

func colorConsoleEnabled() bool {
	if _, disabled := os.LookupEnv("NO_COLOR"); disabled {
		return false
	}

	return !strings.EqualFold(os.Getenv("TERM"), "dumb")
}
