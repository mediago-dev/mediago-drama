package handlers

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

// DocumentToolApprovalStore supplies document tool approval operations.
type DocumentToolApprovalStore interface {
	ListPendingDocumentToolApprovals(projectID string) ([]service.DocumentToolApprovalRecord, error)
	DecideDocumentToolApproval(projectID string, approvalID string, decision string, payload *service.DocumentToolApprovalDecisionPayload) (service.DocumentToolApprovalRecord, error)
	DeleteWorkspaceDocument(projectID string, documentID string) (service.DeleteWorkspaceDocumentResponse, error)
}

// DocumentToolApprovals handles document tool approval HTTP routes.
type DocumentToolApprovals struct {
	store      DocumentToolApprovalStore
	isNotFound func(error) bool
}

// NewDocumentToolApprovals returns a document tool approval route handler.
func NewDocumentToolApprovals(store DocumentToolApprovalStore, isNotFound func(error) bool) DocumentToolApprovals {
	return DocumentToolApprovals{store: store, isNotFound: isNotFound}
}

// HandleListDocumentToolApprovals godoc
// @Summary 获取文档工具审批
// @Description 返回当前项目中等待处理的文档工具审批请求。
// @Tags Agent
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/document-tool-approvals [get]
func (handler DocumentToolApprovals) HandleListDocumentToolApprovals(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	approvals, err := handler.store.ListPendingDocumentToolApprovals(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	slog.Debug(
		"document tool approvals listed",
		"project_id", domain.DiagnosticProjectID(projectID),
		"pending_count", len(approvals),
	)
	httpresponse.OK(context, approvals)
}

// HandleDecideDocumentToolApproval godoc
// @Summary 处理文档工具审批
// @Description 接受或拒绝一个文档工具审批请求。
// @Tags Agent
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param approvalId path string true "Approval ID"
// @Param payload body SwaggerObject true "Approval decision payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/agent/document-tool-approvals/{approvalId}/decision [post]
func (handler DocumentToolApprovals) HandleDecideDocumentToolApproval(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	approvalID, ok := requiredPathParam(context, "approvalId", "approvalId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.DocumentToolApprovalDecisionRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	slog.Info(
		"document tool approval decision received",
		"approval_id", approvalID,
		"project_id", domain.DiagnosticProjectID(projectID),
		"decision", payload.Decision,
		"has_payload", payload.Payload != nil,
	)
	approval, err := handler.store.DecideDocumentToolApproval(projectID, approvalID, payload.Decision, payload.Payload)
	if err != nil {
		if handler.matchesNotFound(err) {
			httpresponse.Error(context, http.StatusNotFound, "确认请求不存在")
			return
		}
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if approval.Status == "approved" && approval.ToolName == "delete_document" && approval.DocumentID != "" {
		if _, err := handler.store.DeleteWorkspaceDocument(projectID, approval.DocumentID); err != nil && !handler.matchesNotFound(err) {
			slog.Warn(
				"approved document delete failed",
				"approval_id", approval.ID,
				"project_id", projectID,
				"document_id", approval.DocumentID,
				"error", err,
			)
		}
	}
	slog.Info(
		"document tool approval decision applied",
		"approval_id", approval.ID,
		"project_id", domain.DiagnosticProjectID(projectID),
		"tool_name", approval.ToolName,
		"status", approval.Status,
		"has_decision_payload", approval.DecisionPayload != nil,
	)
	httpresponse.OK(context, approval)
}

func (handler DocumentToolApprovals) matchesNotFound(err error) bool {
	return handler.isNotFound != nil && handler.isNotFound(err)
}
