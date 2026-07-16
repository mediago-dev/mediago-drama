package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// SidecarTokenHeader authenticates requests from the packaged Electron shell.
const SidecarTokenHeader = "X-MediaGo-Sidecar-Token"

// SidecarToken requires the per-process Electron token when sidecarToken is set.
// Internal agent routes may instead present their independently generated bridge token.
func SidecarToken(sidecarToken string, bridgeToken string) gin.HandlerFunc {
	sidecarToken = strings.TrimSpace(sidecarToken)
	if sidecarToken == "" {
		return func(context *gin.Context) {
			context.Next()
		}
	}
	sidecarDigest := sha256.Sum256([]byte(sidecarToken))
	bridgeToken = strings.TrimSpace(bridgeToken)
	bridgeDigest := sha256.Sum256([]byte(bridgeToken))

	return func(context *gin.Context) {
		if context.Request.Method == http.MethodOptions {
			context.Next()
			return
		}
		providedSidecarDigest := sha256.Sum256(
			[]byte(strings.TrimSpace(context.GetHeader(SidecarTokenHeader))),
		)
		if subtle.ConstantTimeCompare(providedSidecarDigest[:], sidecarDigest[:]) == 1 {
			context.Next()
			return
		}

		if bridgeToken != "" && isInternalAgentPath(context.Request.URL.Path) {
			providedBridge := strings.TrimSpace(strings.TrimPrefix(
				context.GetHeader("Authorization"),
				"Bearer ",
			))
			providedBridgeDigest := sha256.Sum256([]byte(providedBridge))
			if subtle.ConstantTimeCompare(providedBridgeDigest[:], bridgeDigest[:]) == 1 {
				context.Next()
				return
			}
		}

		context.AbortWithStatus(http.StatusUnauthorized)
	}
}

func isInternalAgentPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/internal/") ||
		path == "/api/internal/agent/document-mcp" ||
		path == "/api/internal/agent/generation-mcp"
}
