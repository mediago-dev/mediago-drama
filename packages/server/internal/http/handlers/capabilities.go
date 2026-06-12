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

// HandleListCapabilities returns the atomic capability manifest.
func (handler Capabilities) HandleListCapabilities(context *gin.Context) {
	httpresponse.OK(context, handler.service.ListCapabilities())
}
