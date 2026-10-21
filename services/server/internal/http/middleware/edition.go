package middleware

import "github.com/gin-gonic/gin"

// EditionHeader identifies the open-source server implementation.
const EditionHeader = "X-MediaGo-Edition"

// Edition identifies responses from the open-source server.
func Edition() gin.HandlerFunc {
	return func(context *gin.Context) {
		context.Header(EditionHeader, "community")
		context.Next()
	}
}
