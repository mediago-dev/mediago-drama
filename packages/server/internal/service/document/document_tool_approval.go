package document

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
)

// ApprovedDocumentDeleteResult is the outcome of an approved delete_document flow.
type ApprovedDocumentDeleteResult struct {
	DeletedIDs     []string
	AlreadyDeleted bool
}

// DocumentToolApprovalRecordFromModel maps a persisted approval model to API shape.
func DocumentToolApprovalRecordFromModel(model domain.DocumentToolApprovalModel) (DocumentToolApprovalRecord, error) {
	record := DocumentToolApprovalRecord{
		ID:         model.ID,
		ProjectID:  model.ProjectID,
		ToolName:   model.ToolName,
		DocumentID: model.DocumentID,
		Title:      model.Title,
		Summary:    model.Summary,
		Status:     model.Status,
		CreatedAt:  model.CreatedAt,
		DecidedAt:  model.DecidedAt,
	}
	if model.RequestJSON != "" {
		if err := json.Unmarshal([]byte(model.RequestJSON), &record.Request); err != nil {
			return DocumentToolApprovalRecord{}, fmt.Errorf("decoding document tool approval request: %w", err)
		}
	}
	if model.DecisionPayloadJSON != "" {
		if err := json.Unmarshal([]byte(model.DecisionPayloadJSON), &record.DecisionPayload); err != nil {
			return DocumentToolApprovalRecord{}, fmt.Errorf("decoding document tool approval decision payload: %w", err)
		}
	}
	return record, nil
}

// PrepareDocumentToolApprovalModel builds a new pending approval record and model.
func PrepareDocumentToolApprovalModel(
	projectID string,
	call DocumentToolApprovalRequest,
	approvalID string,
	now string,
) (DocumentToolApprovalRecord, domain.DocumentToolApprovalModel, error) {
	projectID = domain.CleanProjectID(projectID)
	if now == "" {
		now = timestamp.NowRFC3339Nano()
	}
	approval := DocumentToolApprovalRecord{
		ID:         strings.TrimSpace(approvalID),
		ProjectID:  projectID,
		ToolName:   strings.TrimSpace(call.Name),
		DocumentID: strings.TrimSpace(call.DocumentID),
		Title:      strings.TrimSpace(call.Title),
		Summary:    strings.TrimSpace(call.Summary),
		Status:     "pending",
		Request:    call,
		CreatedAt:  now,
	}
	if approval.ID == "" {
		return DocumentToolApprovalRecord{}, domain.DocumentToolApprovalModel{}, fmt.Errorf("approval id is required")
	}
	requestJSON, err := json.Marshal(call)
	if err != nil {
		return DocumentToolApprovalRecord{}, domain.DocumentToolApprovalModel{}, fmt.Errorf("encoding document tool approval request: %w", err)
	}
	model := domain.DocumentToolApprovalModel{
		ProjectID:   projectID,
		ID:          approval.ID,
		ToolName:    approval.ToolName,
		DocumentID:  approval.DocumentID,
		Title:       approval.Title,
		Summary:     approval.Summary,
		Status:      approval.Status,
		RequestJSON: string(requestJSON),
		CreatedAt:   approval.CreatedAt,
		DecidedAt:   "",
	}
	return approval, model, nil
}

// PrepareDocumentToolApprovalDecision normalizes an approval decision update.
func PrepareDocumentToolApprovalDecision(
	projectID string,
	approvalID string,
	decision string,
	payload *DocumentToolApprovalDecisionPayload,
	now string,
) (string, string, string, string, string, error) {
	projectID = domain.CleanProjectID(projectID)
	approvalID = strings.TrimSpace(approvalID)
	status := strings.TrimSpace(decision)
	if status != "approved" && status != "rejected" {
		return "", "", "", "", "", fmt.Errorf("unsupported approval decision %q", decision)
	}
	if now == "" {
		now = timestamp.NowRFC3339Nano()
	}
	decisionPayloadJSON := ""
	if payload != nil {
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return "", "", "", "", "", fmt.Errorf("encoding document tool approval decision payload: %w", err)
		}
		decisionPayloadJSON = string(payloadJSON)
	}
	return projectID, approvalID, status, now, decisionPayloadJSON, nil
}

// DeleteWorkspaceDocumentAfterApproval requests approval and deletes a document after approval.
func (store *Service) DeleteWorkspaceDocumentAfterApproval(
	ctx context.Context,
	projectID string,
	call DocumentToolApprovalRequest,
	expectedVersion int,
	interval time.Duration,
) (ApprovedDocumentDeleteResult, error) {
	approval, err := store.CreateDocumentToolApproval(projectID, call)
	if err != nil {
		return ApprovedDocumentDeleteResult{}, err
	}
	decided, err := store.WaitForDocumentToolApproval(ctx, projectID, approval.ID, interval)
	if err != nil {
		return ApprovedDocumentDeleteResult{}, fmt.Errorf("删除确认等待失败：%w", err)
	}
	if decided.Status != "approved" {
		return ApprovedDocumentDeleteResult{}, fmt.Errorf("用户已拒绝删除文档")
	}

	response, err := store.DeleteWorkspaceDocumentWithExpectedVersion(projectID, call.DocumentID, expectedVersion)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return ApprovedDocumentDeleteResult{AlreadyDeleted: true}, nil
		}
		return ApprovedDocumentDeleteResult{}, err
	}
	return ApprovedDocumentDeleteResult{DeletedIDs: response.DeletedIDs}, nil
}
