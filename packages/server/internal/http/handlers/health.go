package handlers

import (
	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
)

type healthResponse struct {
	Status string `json:"status"`
}

// HandleHealth returns service health.
func HandleHealth(context *gin.Context) {
	httpresponse.OK(context, healthResponse{Status: "ok"})
}
