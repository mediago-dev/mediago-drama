package app

import (
	"context"

	servicedocument "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/document"
)

type documentOperationRunner = servicedocument.DocumentOperationRunner
type mockDocumentOperationRunner = servicedocument.MockDocumentOperationRunner

// RunDocumentOperations runs the document-operation runtime with fallback for HTTP handlers.
func (handler *apiHandler) RunDocumentOperations(ctx context.Context, payload documentOperationsRequest) documentOperationsResponse {
	runner := handler.documentRunner
	if runner == nil {
		runner = servicedocument.MockDocumentOperationRunner{}
	}
	return servicedocument.NewDocumentOperations(
		runner,
		handler.agentRunTimeout,
	).RunDocumentOperations(ctx, payload)
}
