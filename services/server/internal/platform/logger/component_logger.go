package logger

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

// NewComponentLogger returns a logger whose records always land in a
// dedicated daily-rotated JSON file (debug level included), and are also
// forwarded to the process-wide default handler, which applies the global
// level for the console and the main server log. Call it after
// ConfigureDefaultLogger so the forwarded records reach the configured
// handlers. It returns the active log path and a close function.
func NewComponentLogger(component string, logPath string) (*slog.Logger, string, func() error, error) {
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return nil, "", nil, fmt.Errorf("creating %s log directory: %w", component, err)
	}

	file, err := newDailyFileWriter(logPath, timeNow)
	if err != nil {
		return nil, "", nil, fmt.Errorf("opening %s log file: %w", component, err)
	}

	logger := slog.New(newTeeHandler(
		slog.NewJSONHandler(file, &slog.HandlerOptions{Level: slog.LevelDebug}),
		slog.Default().Handler(),
	)).With("component", component)

	return logger, file.CurrentPath(), file.Close, nil
}
