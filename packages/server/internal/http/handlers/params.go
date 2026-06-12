package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
)

func pathParam(context *gin.Context, name string) string {
	return strings.TrimSpace(context.Param(name))
}

func requiredPathParam(context *gin.Context, name string, label string) (string, bool) {
	value := pathParam(context, name)
	if value == "" {
		httpresponse.Error(context, http.StatusBadRequest, "缺少 "+label)
		return "", false
	}
	return value, true
}

func requiredProjectID(context *gin.Context) (string, bool) {
	value := firstNonEmptyParam(pathParam(context, "projectId"), context.Query("projectId"))
	if value == "" {
		httpresponse.Error(context, http.StatusBadRequest, "缺少 projectId")
		return "", false
	}
	projectID := domain.CleanProjectID(value)
	if projectID == "" {
		httpresponse.Error(context, http.StatusBadRequest, "invalid projectId")
		return "", false
	}
	return projectID, true
}

func optionalProjectID(context *gin.Context) string {
	return domain.CleanProjectID(firstNonEmptyParam(pathParam(context, "projectId"), context.Query("projectId")))
}

func firstNonEmptyParam(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
