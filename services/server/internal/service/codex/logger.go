package codex

import (
	"log/slog"
	"sync/atomic"
)

var packageLogger atomic.Pointer[slog.Logger]

// SetLogger directs all Runtime runner and protocol logs to the given logger,
// typically one whose records always reach a dedicated Runtime log file.
func SetLogger(logger *slog.Logger) {
	if logger == nil {
		packageLogger.Store(nil)
		return
	}
	packageLogger.Store(logger)
}

func runtimeLog() *slog.Logger {
	if logger := packageLogger.Load(); logger != nil {
		return logger
	}
	return slog.Default()
}
