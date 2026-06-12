package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	servicebilling "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/billing"
)

// Billing handles billing summary routes.
type Billing struct {
	service *servicebilling.Service
}

// NewBilling returns a billing route handler.
func NewBilling(service *servicebilling.Service) Billing {
	return Billing{service: service}
}

// HandleBillingSummary returns a real-time usage and cost summary.
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
