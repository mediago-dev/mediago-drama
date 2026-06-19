package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

// DocumentToolApprovalRepository persists agent document tool approvals.
type DocumentToolApprovalRepository struct {
	db *gorm.DB
}

// NewDocumentToolApprovalRepository creates a document tool approval repository.
func NewDocumentToolApprovalRepository(db *gorm.DB) *DocumentToolApprovalRepository {
	return &DocumentToolApprovalRepository{db: db}
}

// ListPendingDocumentToolApprovals returns pending approvals for a project.
func (repo *DocumentToolApprovalRepository) ListPendingDocumentToolApprovals(projectID string) ([]domain.DocumentToolApprovalModel, error) {
	models := []domain.DocumentToolApprovalModel{}
	if err := repo.db.Where("project_id = ? AND status = ?", strings.TrimSpace(projectID), "pending").
		Order("created_at ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing document tool approvals: %w", err)
	}
	return models, nil
}

// CreateDocumentToolApproval inserts a document tool approval.
func (repo *DocumentToolApprovalRepository) CreateDocumentToolApproval(model domain.DocumentToolApprovalModel) error {
	if err := repo.db.Create(&model).Error; err != nil {
		return fmt.Errorf("creating document tool approval: %w", err)
	}
	return nil
}

// DecidePendingDocumentToolApproval updates a pending approval and reports whether it changed.
func (repo *DocumentToolApprovalRepository) DecidePendingDocumentToolApproval(projectID string, approvalID string, status string, decidedAt string, decisionPayloadJSON string) (bool, error) {
	updates := map[string]any{
		"status":     strings.TrimSpace(status),
		"decided_at": decidedAt,
	}
	if strings.TrimSpace(decisionPayloadJSON) != "" {
		updates["decision_payload_json"] = decisionPayloadJSON
	}
	result := repo.db.Model(&domain.DocumentToolApprovalModel{}).
		Where("project_id = ? AND id = ? AND status = ?", strings.TrimSpace(projectID), strings.TrimSpace(approvalID), "pending").
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("deciding document tool approval: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

// GetDocumentToolApproval returns a document tool approval by ID.
func (repo *DocumentToolApprovalRepository) GetDocumentToolApproval(projectID string, approvalID string) (domain.DocumentToolApprovalModel, error) {
	var model domain.DocumentToolApprovalModel
	err := repo.db.First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(approvalID)).Error
	if IsRecordNotFound(err) {
		return domain.DocumentToolApprovalModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.DocumentToolApprovalModel{}, fmt.Errorf("getting document tool approval: %w", err)
	}
	return model, nil
}
