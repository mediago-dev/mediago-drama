package handlers

import "github.com/gin-gonic/gin"

func writeNoStoreHeaders(context *gin.Context) {
	context.Header("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate")
	context.Header("Pragma", "no-cache")
	context.Header("Expires", "0")
}
