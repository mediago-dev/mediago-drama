package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// EditionHeader identifies the server implementation serving an API response.
const EditionHeader = "X-MediaGo-Edition"

// Edition adds the normalized server edition to every response.
func Edition(value string) gin.HandlerFunc {
	edition := strings.ToLower(strings.TrimSpace(value))
	if edition == "" {
		edition = "community"
	}
	return func(context *gin.Context) {
		context.Header(EditionHeader, edition)
		context.Next()
	}
}
