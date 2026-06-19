package approval

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func (store *Service) listPendingDocumentToolApprovals(projectID string) ([]documentToolApprovalRecord, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return store.listPendingDocumentToolApprovalsUnlocked(projectID)
}

// ListPendingDocumentToolApprovals returns pending tool approvals for HTTP handlers.
func (store *Service) ListPendingDocumentToolApprovals(projectID string) ([]documentToolApprovalRecord, error) {
	return store.listPendingDocumentToolApprovals(projectID)
}

func (store *Service) listPendingDocumentToolApprovalsUnlocked(projectID string) ([]documentToolApprovalRecord, error) {
	projectID = domain.CleanProjectID(projectID)
	if store.repo == nil {
		return nil, fmt.Errorf("document tool approval repository is not initialized")
	}
	models, err := store.repo.ListPendingDocumentToolApprovals(projectID)
	if err != nil {
		return nil, fmt.Errorf("reading document tool approvals: %w", err)
	}

	approvals := make([]documentToolApprovalRecord, 0, len(models))
	for _, model := range models {
		record, err := DocumentToolApprovalRecordFromModel(model)
		if err != nil {
			return nil, err
		}
		approvals = append(approvals, record)
	}
	return approvals, nil
}

func (store *Service) createDocumentToolApproval(projectID string, call DocumentToolApprovalRequest) (documentToolApprovalRecord, error) {
	if store.initErr != nil {
		return documentToolApprovalRecord{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return store.createDocumentToolApprovalUnlocked(projectID, call)
}

func (store *Service) CreateDocumentToolApproval(projectID string, call DocumentToolApprovalRequest) (documentToolApprovalRecord, error) {
	return store.createDocumentToolApproval(projectID, call)
}

func (store *Service) createDocumentToolApprovalUnlocked(projectID string, call DocumentToolApprovalRequest) (documentToolApprovalRecord, error) {
	if call.ID == "" {
		call.ID = MustRandomID("doc-tool")
	}
	approval, model, err := PrepareDocumentToolApprovalModel(
		projectID,
		call,
		MustRandomID("approval"),
		timestamp.NowRFC3339Nano(),
	)
	if err != nil {
		return documentToolApprovalRecord{}, err
	}
	if store.repo == nil {
		return documentToolApprovalRecord{}, fmt.Errorf("document tool approval repository is not initialized")
	}
	if err := store.repo.CreateDocumentToolApproval(model); err != nil {
		return documentToolApprovalRecord{}, fmt.Errorf("creating document tool approval: %w", err)
	}
	return approval, nil
}

func (store *Service) decideDocumentToolApproval(projectID string, approvalID string, decision string, payload *DocumentToolApprovalDecisionPayload) (documentToolApprovalRecord, error) {
	if store.initErr != nil {
		return documentToolApprovalRecord{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID, approvalID, status, now, decisionPayloadJSON, err := PrepareDocumentToolApprovalDecision(
		projectID,
		approvalID,
		decision,
		payload,
		timestamp.NowRFC3339Nano(),
	)
	if err != nil {
		return documentToolApprovalRecord{}, err
	}
	if store.repo == nil {
		return documentToolApprovalRecord{}, fmt.Errorf("document tool approval repository is not initialized")
	}
	updated, err := store.repo.DecidePendingDocumentToolApproval(projectID, approvalID, status, now, decisionPayloadJSON)
	if err != nil {
		return documentToolApprovalRecord{}, fmt.Errorf("updating document tool approval: %w", err)
	}
	if !updated {
		record, ok, getErr := store.getDocumentToolApprovalUnlocked(projectID, approvalID)
		if getErr != nil {
			return documentToolApprovalRecord{}, getErr
		}
		if !ok {
			return documentToolApprovalRecord{}, repository.ErrRecordNotFound
		}
		return record, nil
	}
	record, ok, err := store.getDocumentToolApprovalUnlocked(projectID, approvalID)
	if err != nil {
		return documentToolApprovalRecord{}, err
	}
	if !ok {
		return documentToolApprovalRecord{}, repository.ErrRecordNotFound
	}
	return record, nil
}

// DecideDocumentToolApproval applies a tool approval decision for HTTP handlers.
func (store *Service) DecideDocumentToolApproval(projectID string, approvalID string, decision string, payload *DocumentToolApprovalDecisionPayload) (documentToolApprovalRecord, error) {
	return store.decideDocumentToolApproval(projectID, approvalID, decision, payload)
}

func (store *Service) waitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (documentToolApprovalRecord, error) {
	if interval <= 0 {
		interval = 500 * time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		store.mu.Lock()
		record, ok, err := store.getDocumentToolApprovalUnlocked(projectID, approvalID)
		store.mu.Unlock()
		if err != nil {
			return documentToolApprovalRecord{}, err
		}
		if !ok {
			return documentToolApprovalRecord{}, repository.ErrRecordNotFound
		}
		if record.Status != "pending" {
			return record, nil
		}

		select {
		case <-ctx.Done():
			return record, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (store *Service) WaitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (documentToolApprovalRecord, error) {
	return store.waitForDocumentToolApproval(ctx, projectID, approvalID, interval)
}

func (store *Service) getDocumentToolApprovalUnlocked(projectID string, approvalID string) (documentToolApprovalRecord, bool, error) {
	projectID = domain.CleanProjectID(projectID)
	approvalID = strings.TrimSpace(approvalID)
	if store.repo == nil {
		return documentToolApprovalRecord{}, false, fmt.Errorf("document tool approval repository is not initialized")
	}
	model, err := store.repo.GetDocumentToolApproval(projectID, approvalID)
	if repository.IsRecordNotFound(err) {
		return documentToolApprovalRecord{}, false, nil
	}
	if err != nil {
		return documentToolApprovalRecord{}, false, err
	}
	record, err := DocumentToolApprovalRecordFromModel(model)
	if err != nil {
		return documentToolApprovalRecord{}, false, err
	}
	return record, true, nil
}
