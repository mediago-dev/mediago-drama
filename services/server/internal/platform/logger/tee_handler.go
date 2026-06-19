package logger

import (
	"context"
	"log/slog"
)

type teeHandler struct {
	handlers []slog.Handler
}

func newTeeHandler(handlers ...slog.Handler) slog.Handler {
	return teeHandler{handlers: handlers}
}

func (handler teeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, child := range handler.handlers {
		if child.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (handler teeHandler) Handle(ctx context.Context, record slog.Record) error {
	for _, child := range handler.handlers {
		if !child.Enabled(ctx, record.Level) {
			continue
		}
		if err := child.Handle(ctx, record.Clone()); err != nil {
			return err
		}
	}
	return nil
}

func (handler teeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	children := make([]slog.Handler, 0, len(handler.handlers))
	for _, child := range handler.handlers {
		children = append(children, child.WithAttrs(attrs))
	}
	return teeHandler{handlers: children}
}

func (handler teeHandler) WithGroup(name string) slog.Handler {
	children := make([]slog.Handler, 0, len(handler.handlers))
	for _, child := range handler.handlers {
		children = append(children, child.WithGroup(name))
	}
	return teeHandler{handlers: children}
}
