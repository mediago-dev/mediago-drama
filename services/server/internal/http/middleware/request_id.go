package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	requestIDContextKey = "request_id"
	requestIDHeader     = "X-Request-ID"
)

// RequestID assigns a stable request id so console summaries and log files can
// be connected during debugging.
func RequestID() gin.HandlerFunc {
	return func(context *gin.Context) {
		requestID := strings.TrimSpace(context.GetHeader(requestIDHeader))
		if requestID == "" {
			requestID = randomRequestID()
		}
		context.Set(requestIDContextKey, requestID)
		context.Writer.Header().Set(requestIDHeader, requestID)
		context.Next()
	}
}

func requestIDFromContext(context *gin.Context) string {
	value, ok := context.Get(requestIDContextKey)
	if !ok {
		return ""
	}
	requestID, _ := value.(string)
	return strings.TrimSpace(requestID)
}

func randomRequestID() string {
	var data [8]byte
	if _, err := rand.Read(data[:]); err == nil {
		return "req-" + hex.EncodeToString(data[:])
	}
	return "req-" + fmt.Sprintf("%d", time.Now().UnixNano())
}

func requestIDFromHeader(request *http.Request) string {
	if request == nil {
		return ""
	}
	return strings.TrimSpace(request.Header.Get(requestIDHeader))
}
