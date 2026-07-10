package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/license"
)

// License exposes activation status and activation operations backed by the
// private license server. All endpoints degrade gracefully when no license
// server is configured.
type License struct {
	client *license.Client
}

// NewLicense creates the license handler.
func NewLicense(client *license.Client) License {
	return License{client: client}
}

type activateLicenseRequest struct {
	Code string `json:"code" binding:"required"`
}

// HandleStatus godoc
// @Summary 查询授权状态
// @Description 返回当前激活状态、套餐与权益。
// @Tags License
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/license [get]
func (handler License) HandleStatus(context *gin.Context) {
	httpresponse.OK(context, handler.client.Status())
}

// HandleActivate godoc
// @Summary 激活授权
// @Description 使用激活码向授权服务器激活并保存签名 token。
// @Tags License
// @Accept json
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 502 {object} SwaggerEnvelope
// @Router /api/v1/license/activate [post]
func (handler License) HandleActivate(context *gin.Context) {
	var request activateLicenseRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("激活码不能为空"))
		return
	}
	status, err := handler.client.Activate(context.Request.Context(), request.Code)
	switch {
	case errors.Is(err, license.ErrNotConfigured):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("未配置授权服务器"))
		return
	case errors.Is(err, license.ErrActivationRejected):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
		return
	case errors.Is(err, license.ErrServerUnavailable):
		httpresponse.ErrorFromStatus(context, http.StatusBadGateway, err)
		return
	case err != nil:
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, err)
		return
	}
	httpresponse.OK(context, status)
}

// HandleDeactivate godoc
// @Summary 取消激活
// @Description 删除本地保存的授权。传 licenseId 只取消该激活，否则全部取消。
// @Tags License
// @Produce json
// @Param licenseId query string false "只取消该 license 的激活"
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/license [delete]
func (handler License) HandleDeactivate(context *gin.Context) {
	status, err := handler.client.Deactivate(context.Query("licenseId"))
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusInternalServerError, err)
		return
	}
	httpresponse.OK(context, status)
}
