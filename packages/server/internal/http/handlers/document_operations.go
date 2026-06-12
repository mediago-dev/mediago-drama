package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
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

// HandleDocumentOperations runs document operations for the current payload.
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

// HandleTestDocumentOperations runs a fixed document operation test payload.
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
