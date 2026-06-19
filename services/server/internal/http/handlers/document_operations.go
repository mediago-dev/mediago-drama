package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
)

// DocumentOperationsRunner runs backend document operations.
type DocumentOperationsRunner interface {
	RunDocumentOperations(ctx context.Context, payload service.DocumentOperationsRequest) service.DocumentOperationsResponse
}

// DocumentOperations handles document operation HTTP routes.
type DocumentOperations struct {
	runner DocumentOperationsRunner
}

// NewDocumentOperations returns a document operation route handler.
func NewDocumentOperations(runner DocumentOperationsRunner) DocumentOperations {
	return DocumentOperations{runner: runner}
}

// HandleDocumentOperations godoc
// @Summary 执行文档操作
// @Description 根据请求体执行 Agent 生成的文档操作。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Document operations payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/document-operations [post]
func (handler DocumentOperations) HandleDocumentOperations(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.DocumentOperationsRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	payload.ProjectID = projectID
	if !service.HasDocumentOperationWork(payload) {
		httpresponse.Error(context, http.StatusBadRequest, "缺少 prompt")
		return
	}

	httpresponse.OK(context, handler.runner.RunDocumentOperations(context.Request.Context(), payload))
}

// HandleTestDocumentOperations godoc
// @Summary 测试文档操作
// @Description 使用固定测试载荷执行文档操作验证。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/document-operations/test [post]
func (handler DocumentOperations) HandleTestDocumentOperations(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload := service.DocumentOperationsRequest{
		Prompt:    "生成一个简短角色设定，用于测试 document operation runtime。",
		ProjectID: projectID,
		Document: service.AgentDocumentContext{
			ID:      "runtime-test",
			Title:   "运行时测试",
			Content: "# 运行时测试\n\n## 角色\n\n",
		},
	}

	httpresponse.OK(context, handler.runner.RunDocumentOperations(context.Request.Context(), payload))
}
