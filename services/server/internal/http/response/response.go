// Package response owns HTTP response envelopes for the CLI server.
package response

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Envelope is the consistent JSON response shape returned by the API.
type Envelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Success bool            `json:"success"`
}

// OK writes a successful response.
func OK[TResponse any](context *gin.Context, data TResponse) {
	rawData, err := json.Marshal(data)
	if err != nil {
		Error(context, http.StatusInternalServerError, "响应编码失败")
		return
	}

	JSON(context, http.StatusOK, Envelope{
		Code:    0,
		Message: "成功",
		Data:    rawData,
		Success: true,
	})
}

// Error writes an error response and stores the message for request logging.
func Error(context *gin.Context, status int, message string) {
	context.Set("api_error_message", message)
	JSON(context, status, Envelope{
		Code:    status,
		Message: message,
		Data:    []byte("null"),
		Success: false,
	})
}

// Fail logs the internal error and writes a safe public error response.
func Fail(context *gin.Context, status int, publicMessage string, err error) {
	slog.Error(
		"request failed",
		"method", context.Request.Method,
		"path", context.FullPath(),
		"status", status,
		"request_id", requestID(context),
		"error", err,
	)
	Error(context, status, publicMessage)
}

// ErrorFromStatus writes err directly for client errors and hides it for server errors.
func ErrorFromStatus(context *gin.Context, status int, err error) {
	if status == 0 {
		status = http.StatusInternalServerError
	}
	if status >= http.StatusInternalServerError {
		if err == nil {
			err = errors.New(http.StatusText(status))
		}
		Fail(context, status, "internal error", err)
		return
	}
	if err == nil {
		Error(context, status, http.StatusText(status))
		return
	}
	Error(context, status, err.Error())
}

// PublicErrorMessage returns the message safe to send to the client for err.
func PublicErrorMessage(status int, err error) string {
	if status == 0 || status >= http.StatusInternalServerError {
		return "internal error"
	}
	if err == nil {
		return http.StatusText(status)
	}
	return err.Error()
}

// JSON writes a response envelope with an explicit status.
func JSON(context *gin.Context, status int, payload Envelope) {
	context.JSON(status, payload)
}

func requestID(context *gin.Context) string {
	value, ok := context.Get("request_id")
	if !ok {
		return ""
	}
	requestID, _ := value.(string)
	return requestID
}
