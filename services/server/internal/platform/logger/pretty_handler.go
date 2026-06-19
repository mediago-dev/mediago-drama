package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type prettyHandlerOptions struct {
	Level slog.Leveler
	Color bool
}

type prettyHandler struct {
	mu     *sync.Mutex
	writer io.Writer
	level  slog.Leveler
	color  bool
	attrs  []slog.Attr
	group  string
}

func newPrettyHandler(writer io.Writer, options prettyHandlerOptions) slog.Handler {
	if options.Level == nil {
		options.Level = slog.LevelInfo
	}
	return &prettyHandler{
		mu:     &sync.Mutex{},
		writer: writer,
		level:  options.Level,
		color:  options.Color,
	}
}

func (handler *prettyHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= handler.level.Level()
}

func (handler *prettyHandler) Handle(_ context.Context, record slog.Record) error {
	line := handler.format(record)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	_, err := fmt.Fprintln(handler.writer, line)
	return err
}

func (handler *prettyHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *handler
	next.attrs = append(append([]slog.Attr(nil), handler.attrs...), attrs...)
	return &next
}

func (handler *prettyHandler) WithGroup(name string) slog.Handler {
	if strings.TrimSpace(name) == "" {
		return handler
	}
	next := *handler
	if next.group == "" {
		next.group = name
	} else {
		next.group += "." + name
	}
	return &next
}

func (handler *prettyHandler) format(record slog.Record) string {
	attrs := handler.collectAttrs(record)
	if looksLikeHTTPRequest(attrs) {
		return handler.formatHTTPRequest(record, attrs)
	}
	return handler.formatGeneral(record, attrs)
}

func (handler *prettyHandler) collectAttrs(record slog.Record) map[string]string {
	attrs := map[string]string{}
	for _, attr := range handler.attrs {
		handler.addAttr(attrs, attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		handler.addAttr(attrs, attr)
		return true
	})
	return attrs
}

func (handler *prettyHandler) addAttr(attrs map[string]string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	if attr.Equal(slog.Attr{}) {
		return
	}
	key := attr.Key
	if handler.group != "" {
		key = handler.group + "." + key
	}
	attrs[key] = valueString(attr.Value)
}

func (handler *prettyHandler) formatHTTPRequest(record slog.Record, attrs map[string]string) string {
	status := attrs["status"]
	method := attrs["method"]
	path := attrs["path"]
	duration := durationLabel(attrs)
	clientIP := attrs["client_ip"]
	level := strings.ToUpper(record.Level.String())

	main := fmt.Sprintf(
		"%s  %s  %s  %s  %-64s  %6s  %s",
		record.Time.Format("15:04:05.000"),
		handler.colorizeLevel(fmt.Sprintf("%-5s", level), record.Level),
		handler.colorizeStatus(fmt.Sprintf("%3s", status), status),
		handler.colorizeMethod(fmt.Sprintf("%-6s", method), method),
		path,
		duration,
		clientIP,
	)

	detail := []string{}
	if errText := attrs["error"]; errText != "" {
		detail = append(detail, errText)
	}
	if ginErrors := attrs["gin_errors"]; ginErrors != "" {
		detail = append(detail, "gin_errors="+ginErrors)
	}
	if requestID := attrs["request_id"]; requestID != "" && isProblemStatus(status) {
		detail = append(detail, "request_id="+requestID)
	}
	if record.Message != "" && record.Message != "http request" {
		detail = append(detail, "msg="+record.Message)
	}

	if len(detail) == 0 {
		return main
	}
	return main + "\n" + indentDetails(detail)
}

func (handler *prettyHandler) formatGeneral(record slog.Record, attrs map[string]string) string {
	level := strings.ToUpper(record.Level.String())
	main := fmt.Sprintf(
		"%s  %s  %s",
		record.Time.Format("15:04:05.000"),
		handler.colorizeLevel(fmt.Sprintf("%-5s", level), record.Level),
		record.Message,
	)

	detail := []string{}
	for _, key := range sortedKeys(attrs) {
		value := attrs[key]
		if key == "stack" {
			if value != "" {
				detail = append(detail, "stack=<written to log file>")
			}
			continue
		}
		detail = append(detail, key+"="+value)
	}
	if len(detail) == 0 {
		return main
	}
	return main + "\n" + indentDetails(detail)
}

func (handler *prettyHandler) colorizeLevel(value string, level slog.Level) string {
	if !handler.color {
		return value
	}
	switch {
	case level >= slog.LevelError:
		return ansiRed + value + ansiReset
	case level >= slog.LevelWarn:
		return ansiYellow + value + ansiReset
	case level <= slog.LevelDebug:
		return ansiDim + value + ansiReset
	default:
		return ansiCyan + value + ansiReset
	}
}

func (handler *prettyHandler) colorizeStatus(value string, statusText string) string {
	if !handler.color {
		return value
	}
	status, err := strconv.Atoi(strings.TrimSpace(statusText))
	if err != nil {
		return value
	}
	switch {
	case status >= http.StatusInternalServerError:
		return ansiRed + value + ansiReset
	case status >= http.StatusBadRequest:
		return ansiYellow + value + ansiReset
	case status >= http.StatusMultipleChoices:
		return ansiBlue + value + ansiReset
	default:
		return ansiGreen + value + ansiReset
	}
}

func (handler *prettyHandler) colorizeMethod(value string, method string) string {
	if !handler.color {
		return value
	}
	switch strings.TrimSpace(method) {
	case http.MethodGet:
		return ansiBlue + value + ansiReset
	case http.MethodPost:
		return ansiGreen + value + ansiReset
	case http.MethodPut, http.MethodPatch:
		return ansiMagenta + value + ansiReset
	case http.MethodDelete:
		return ansiRed + value + ansiReset
	default:
		return ansiCyan + value + ansiReset
	}
}

func looksLikeHTTPRequest(attrs map[string]string) bool {
	return attrs["method"] != "" && attrs["path"] != "" && attrs["status"] != ""
}

func durationLabel(attrs map[string]string) string {
	if value := attrs["duration_ms"]; value != "" {
		return value + "ms"
	}
	if value := attrs["duration"]; value != "" {
		return value
	}
	return "-"
}

func isProblemStatus(statusText string) bool {
	status, err := strconv.Atoi(statusText)
	return err == nil && status >= http.StatusBadRequest
}

func indentDetails(details []string) string {
	const indent = "                       "
	return indent + strings.Join(details, "\n"+indent)
}

func sortedKeys(attrs map[string]string) []string {
	keys := make([]string, 0, len(attrs))
	for key := range attrs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func valueString(value slog.Value) string {
	switch value.Kind() {
	case slog.KindString:
		return value.String()
	case slog.KindInt64:
		return strconv.FormatInt(value.Int64(), 10)
	case slog.KindUint64:
		return strconv.FormatUint(value.Uint64(), 10)
	case slog.KindFloat64:
		return strconv.FormatFloat(value.Float64(), 'f', -1, 64)
	case slog.KindBool:
		return strconv.FormatBool(value.Bool())
	case slog.KindDuration:
		return value.Duration().String()
	case slog.KindTime:
		return value.Time().Format(time.RFC3339Nano)
	case slog.KindAny:
		return fmt.Sprint(value.Any())
	default:
		return value.String()
	}
}
