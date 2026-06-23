package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// LocalCORS allows browser-based desktop shells to call the local API server.
func LocalCORS() gin.HandlerFunc {
	return func(context *gin.Context) {
		origin := strings.TrimSpace(context.Request.Header.Get("Origin"))
		if isAllowedLocalOrigin(origin) {
			header := context.Writer.Header()
			header.Set("Access-Control-Allow-Origin", origin)
			header.Set("Access-Control-Allow-Credentials", "true")
			header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID")
			header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			header.Add("Vary", "Origin")
		}

		if context.Request.Method == http.MethodOptions {
			context.AbortWithStatus(http.StatusNoContent)
			return
		}
		context.Next()
	}
}

func isAllowedLocalOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch parsed.Scheme {
	case "http", "https", "app":
	case "file":
		return true
	default:
		return false
	}
	host := parsed.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
