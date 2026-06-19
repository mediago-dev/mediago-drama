package handlers

import (
	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	servicecapability "github.com/mediago-dev/mediago-drama/packages/server/internal/service/capability"
)

// Capabilities handles capability manifest routes.
type Capabilities struct {
	service *servicecapability.Service
}

// NewCapabilities returns a capability route handler.
func NewCapabilities(service *servicecapability.Service) Capabilities {
	return Capabilities{service: service}
}

// HandleListCapabilities godoc
// @Summary 获取能力清单
// @Description 返回服务端支持的原子能力与模型相关能力清单。
// @Tags Capabilities
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/capabilities [get]
func (handler Capabilities) HandleListCapabilities(context *gin.Context) {
	httpresponse.OK(context, handler.service.ListCapabilities())
}
