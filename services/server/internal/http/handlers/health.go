package handlers

import (
	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
)

type healthResponse struct {
	Status string `json:"status"`
}

// HandleHealth godoc
// @Summary 服务健康检查
// @Description 返回本地服务是否可用。
// @Tags System
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/health [get]
func HandleHealth(context *gin.Context) {
	httpresponse.OK(context, healthResponse{Status: "ok"})
}
