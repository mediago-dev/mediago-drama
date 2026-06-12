package approval

import (
	"fmt"
	"sync"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/repository"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/document"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/model"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"
)

type DocumentToolApprovalRecord = model.DocumentToolApprovalRecord
type DocumentToolApprovalRequest = model.DocumentToolApprovalRequest
type DocumentToolApprovalDecisionPayload = model.DocumentToolApprovalDecisionPayload
type DocumentToolApprovalConfig = model.DocumentToolApprovalConfig
type documentToolApprovalRecord = model.DocumentToolApprovalRecord
type documentToolApprovalModel = model.DocumentToolApprovalRecord

var (
	DocumentToolApprovalRecordFromModel = document.DocumentToolApprovalRecordFromModel
	PrepareDocumentToolApprovalModel    = document.PrepareDocumentToolApprovalModel
	PrepareDocumentToolApprovalDecision = document.PrepareDocumentToolApprovalDecision
	MustRandomID                        = shared.MustRandomID
)

// Service owns document tool approvals.
type Service struct {
	mu      sync.RWMutex
	repo    *repository.DocumentToolApprovalRepository
	initErr error
}

// NewService returns an approval service backed by a repository.
func NewService(repo *repository.DocumentToolApprovalRepository, initErr error) *Service {
	service := &Service{repo: repo, initErr: initErr}
	if service.initErr == nil && service.repo == nil {
		service.initErr = fmt.Errorf("document tool approval repository is nil")
	}
	return service
}
