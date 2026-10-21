package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	serviceusage "github.com/mediago-dev/mediago-drama/services/server/internal/service/usage"
)

// Usage handles usage summary routes.
type Usage struct {
	service *serviceusage.Service
}

// NewUsage returns a usage route handler.
func NewUsage(service *serviceusage.Service) Usage {
	return Usage{service: service}
}

// HandleUsageSummary godoc
// @Summary 获取全局用量汇总
// @Description 按时间、类型和维度汇总生成任务使用量。
// @Tags Usage
// @Produce json
// @Param start query string false "Start date or timestamp"
// @Param end query string false "End date or timestamp"
// @Param groupBy query string false "Grouping dimension" default(model)
// @Param kind query string false "Generation kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/usage/summary [get]
func (handler Usage) HandleUsageSummary(context *gin.Context) {
	response, err := handler.service.Summary(serviceusage.SummaryRequest{
		Start:     context.Query("start"),
		End:       context.Query("end"),
		GroupBy:   context.DefaultQuery("groupBy", "model"),
		Kind:      context.Query("kind"),
		ProjectID: optionalProjectID(context),
	})
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "用量汇总失败", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleProjectUsageSummary godoc
// @Summary 获取项目用量汇总
// @Description 按项目范围汇总生成任务使用量。
// @Tags Usage
// @Produce json
// @Param projectId path string true "Project ID"
// @Param start query string false "Start date or timestamp"
// @Param end query string false "End date or timestamp"
// @Param groupBy query string false "Grouping dimension" default(model)
// @Param kind query string false "Generation kind"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/usage/summary [get]
func (handler Usage) HandleProjectUsageSummary(context *gin.Context) {
	handler.HandleUsageSummary(context)
}
