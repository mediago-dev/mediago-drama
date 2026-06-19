package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	servicebilling "github.com/mediago-dev/mediago-drama/packages/server/internal/service/billing"
)

// Billing handles billing summary routes.
type Billing struct {
	service *servicebilling.Service
}

// NewBilling returns a billing route handler.
func NewBilling(service *servicebilling.Service) Billing {
	return Billing{service: service}
}

// HandleBillingSummary godoc
// @Summary 获取全局费用汇总
// @Description 按时间、类型和维度汇总生成任务使用量与费用。
// @Tags Billing
// @Produce json
// @Param start query string false "Start date or timestamp"
// @Param end query string false "End date or timestamp"
// @Param groupBy query string false "Grouping dimension" default(model)
// @Param kind query string false "Generation kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/billing/summary [get]
func (handler Billing) HandleBillingSummary(context *gin.Context) {
	response, err := handler.service.Summary(servicebilling.SummaryRequest{
		Start:     context.Query("start"),
		End:       context.Query("end"),
		GroupBy:   context.DefaultQuery("groupBy", "model"),
		Kind:      context.Query("kind"),
		ProjectID: optionalProjectID(context),
	})
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "计费汇总失败", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleProjectBillingSummary godoc
// @Summary 获取项目费用汇总
// @Description 按项目范围汇总生成任务使用量与费用。
// @Tags Billing
// @Produce json
// @Param projectId path string true "Project ID"
// @Param start query string false "Start date or timestamp"
// @Param end query string false "End date or timestamp"
// @Param groupBy query string false "Grouping dimension" default(model)
// @Param kind query string false "Generation kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/billing/summary [get]
func (handler Billing) HandleProjectBillingSummary(context *gin.Context) {
	handler.HandleBillingSummary(context)
}
