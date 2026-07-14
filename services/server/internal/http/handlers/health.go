package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
)

type healthResponse struct {
	Ready  bool   `json:"ready"`
	Status string `json:"status"`
}

// HealthReadiness reports whether startup dependencies initialized successfully.
type HealthReadiness func() error

// Health exposes the server readiness probe.
type Health struct {
	readiness HealthReadiness
}

// NewHealth creates a readiness handler.
func NewHealth(readiness HealthReadiness) Health {
	return Health{readiness: readiness}
}

// HandleHealth godoc
// @Summary 服务健康检查
// @Description 返回本地服务是否完成数据库与工作区初始化。
// @Tags System
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 503 {object} SwaggerEnvelope
// @Router /api/v1/health [get]
func (handler Health) HandleHealth(context *gin.Context) {
	ready := handler.readiness == nil || handler.readiness() == nil
	payload := healthResponse{Ready: ready, Status: "ok"}
	if ready {
		httpresponse.OK(context, payload)
		return
	}

	payload.Status = "not_ready"
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		httpresponse.Error(context, http.StatusInternalServerError, "响应编码失败")
		return
	}
	httpresponse.JSON(context, http.StatusServiceUnavailable, httpresponse.Envelope{
		Code:    http.StatusServiceUnavailable,
		Message: "服务尚未就绪",
		Data:    rawPayload,
		Success: false,
	})
}
