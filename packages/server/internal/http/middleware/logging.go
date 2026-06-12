// Package middleware owns Gin middleware for the server.
package middleware

import (
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// ErrorWriter writes a structured error response for middleware failures.
type ErrorWriter func(context *gin.Context, status int, message string)

// RequestLogger logs API requests and failed non-API requests.
func RequestLogger() gin.HandlerFunc {
	return func(context *gin.Context) {
		start := time.Now()
		context.Next()

		path := context.Request.URL.Path
		status := context.Writer.Status()
		if !strings.HasPrefix(path, "/api/") && status < http.StatusBadRequest {
			return
		}

		args := []any{
			"method", context.Request.Method,
			"path", path,
			"status", status,
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", context.ClientIP(),
		}
		if requestID := firstNonEmpty(requestIDFromContext(context), requestIDFromHeader(context.Request)); requestID != "" {
			args = append(args, "request_id", requestID)
		}
		if message, ok := context.Get("api_error_message"); ok {
			messageText, _ := message.(string)
			args = append(args, "error", message)
			args = append(args, "error_kind", classifyHTTPError(status, messageText))
		}
		if rawErrors := strings.TrimSpace(context.Errors.String()); rawErrors != "" {
			args = append(args, "gin_errors", rawErrors)
		}

		switch {
		case status >= http.StatusInternalServerError:
			slog.Error("http request", args...)
		case isExpectedDocumentMCPHangingGET(context.Request.Method, path, status):
			slog.Debug("http request", args...)
		case status >= http.StatusBadRequest:
			slog.Warn("http request", args...)
		default:
			slog.Debug("http request", args...)
		}
	}
}

func isExpectedDocumentMCPHangingGET(method string, path string, status int) bool {
	if method != http.MethodGet || status != http.StatusMethodNotAllowed {
		return false
	}
	return path == mediamcp.DocumentHTTPPath ||
		path == mediamcp.LegacyDocumentHTTPPath ||
		(strings.HasPrefix(path, "/api/v1/internal/projects/") && strings.HasSuffix(path, "/agent/document-mcp"))
}

// RecoveryLogger logs panics and delegates response writing to the HTTP layer.
func RecoveryLogger(writeError ErrorWriter) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(context *gin.Context, recovered any) {
		slog.Error(
			"panic recovered",
			"method", context.Request.Method,
			"path", context.Request.URL.Path,
			"request_id", requestIDFromContext(context),
			"panic", recovered,
			"stack", string(debug.Stack()),
		)
		writeError(context, http.StatusInternalServerError, "internal server error")
	})
}

func classifyHTTPError(status int, message string) string {
	switch {
	case status == http.StatusNotFound && strings.EqualFold(message, "api route not found"):
		return "route_not_found"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "auth"
	case status == http.StatusBadRequest || status == http.StatusUnprocessableEntity:
		return "validation"
	case status >= http.StatusInternalServerError:
		return "internal"
	case status >= http.StatusBadRequest:
		return "client"
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
