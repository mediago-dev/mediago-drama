package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
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

// parseDocumentIDsQuery parses a comma-separated document ids query value. The
// boolean reports whether the request is scoped to specific documents; it is only
// true when at least one non-empty id is present, so a missing or blank "ids"
// param falls back to returning the full document list.
func parseDocumentIDsQuery(raw string) ([]string, bool) {
	parts := strings.Split(raw, ",")
	ids := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	return ids, len(ids) > 0
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
