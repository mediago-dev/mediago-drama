package repository

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

var (
	// ErrAgentCommandConflict reports reuse of an idempotency key with a different payload.
	ErrAgentCommandConflict = errors.New("agent command payload conflicts with persisted result")
	// ErrAgentStaleRevision reports that an optimistic revision or expected state no longer matches.
	ErrAgentStaleRevision = errors.New("agent execution revision is stale")
	// ErrAgentStaleFence reports that a lease owner or fence token no longer matches.
	ErrAgentStaleFence = errors.New("agent execution lease fence is stale")
	// ErrAgentInvalidCAS reports an incomplete compare-and-swap request.
	ErrAgentInvalidCAS = errors.New("agent execution compare-and-swap request is incomplete")
)

// AgentExecutionRepository persists passive workflow projections and recovery state.
type AgentExecutionRepository struct {
	db *gorm.DB
}

// NewAgentExecutionRepository creates an Agent execution repository.
func NewAgentExecutionRepository(db *gorm.DB) *AgentExecutionRepository {
	return &AgentExecutionRepository{db: db}
}

// AgentIdempotentEventResult describes an idempotent event insert or replay.
type AgentIdempotentEventResult struct {
	Applied bool
	Event   domain.AgentWorkflowEventModel
}

// AgentProjectionWriteSet is a service-computed set of projection inserts that
// must become visible atomically with its idempotency event.
type AgentProjectionWriteSet struct {
	Event                     domain.AgentWorkflowEventModel
	UpdateWorkflows           []AgentWorkflowCASWrite
	UpdateTasks               []AgentTaskCASWrite
	UpdateInvocations         []AgentInvocationCASWrite
	UpdateArtifacts           []AgentArtifactCASWrite
	CreateWorkflows           []domain.AgentWorkflowModel
	CreateTasks               []domain.AgentTaskModel
	CreateInvocations         []domain.AgentInvocationModel
	CreateArtifacts           []domain.AgentArtifactModel
	CreateRootProposals       []domain.AgentRootProposalModel
	CreateRootFinalDeliveries []domain.AgentRootFinalDeliveryModel
	CreateWorkflowHandoffs    []domain.AgentWorkflowHandoffModel
	CreateQueuedInputs        []domain.AgentQueuedInputModel
}

// AgentWorkflowCASWrite is a workflow projection replacement at an expected revision.
type AgentWorkflowCASWrite struct {
	ExpectedRevision uint64
	Next             domain.AgentWorkflowModel
}

// AgentTaskCASWrite is a Task projection replacement at an expected revision.
type AgentTaskCASWrite struct {
	ExpectedRevision uint64
	Next             domain.AgentTaskModel
}

// AgentInvocationCASWrite is an Invocation projection replacement at an expected revision.
type AgentInvocationCASWrite struct {
	ExpectedRevision uint64
	Next             domain.AgentInvocationModel
}

// AgentArtifactCASWrite is an Artifact projection replacement at an expected version.
type AgentArtifactCASWrite struct {
	ExpectedVersion uint64
	Next            domain.AgentArtifactModel
}

// AgentCommandResult is the first persisted result of a fenced command.
type AgentCommandResult struct {
	Applied    bool
	Revision   uint64
	ResultJSON string
}

// AgentRecoverableState separates automatic recovery work from integrity issues.
type AgentRecoverableState struct {
	ActiveWorkflows                []domain.AgentWorkflowModel
	Continuations                  []domain.AgentWorkflowEventModel
	PublishableRootFinalDeliveries []domain.AgentRootFinalDeliveryModel
	FailedRootFinalDeliveries      []domain.AgentRootFinalDeliveryModel
	WorkflowHandoffs               []domain.AgentWorkflowHandoffModel
}

// AgentRootFinalDeliveryTransition is a service-authorized phase CAS. The
// repository validates scope, revision, fence, and command idempotency only.
type AgentRootFinalDeliveryTransition struct {
	ProjectID          string
	SessionID          string
	DeliveryID         string
	ExpectedPhase      string
	NextPhase          string
	ExpectedRevision   uint64
	LeaseOwner         string
	LeaseToken         uint64
	CommandID          string
	CommandFingerprint string
	ResultJSON         string
	FailureCode        string
	LastError          string
	NextAttemptAt      *time.Time
	JSONLFirstSequence uint64
	JSONLLastSequence  uint64
	At                 time.Time
}

// AgentWorkflowHandoffTransition is a service-authorized handoff status CAS.
type AgentWorkflowHandoffTransition struct {
	ProjectID          string
	SessionID          string
	HandoffID          string
	ExpectedStatus     string
	NextStatus         string
	ExpectedRevision   uint64
	LeaseOwner         string
	LeaseToken         uint64
	CommandID          string
	CommandFingerprint string
	ResultJSON         string
	LastError          string
	NextAttemptAt      *time.Time
	RemoteMessageID    string
	RemoteCorrelation  string
	At                 time.Time
}

// CreateWorkflowEvent inserts an event once per workflow idempotency key.
func (repo *AgentExecutionRepository) CreateWorkflowEvent(
	ctx context.Context,
	event domain.AgentWorkflowEventModel,
) (AgentIdempotentEventResult, error) {
	var result AgentIdempotentEventResult
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var err error
		result, err = createWorkflowEventTx(tx, event)
		return err
	})
	if err != nil {
		return AgentIdempotentEventResult{}, err
	}
	return result, nil
}

// ApplyProjectionWriteSet atomically inserts a service-computed projection set.
// Replaying the same command returns its first event and performs no writes.
func (repo *AgentExecutionRepository) ApplyProjectionWriteSet(
	ctx context.Context,
	set AgentProjectionWriteSet,
) (AgentIdempotentEventResult, error) {
	var result AgentIdempotentEventResult
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var err error
		result, err = createWorkflowEventTx(tx, set.Event)
		if err != nil || !result.Applied {
			return err
		}
		if err := applyProjectionCASWritesTx(tx, set); err != nil {
			return err
		}
		for _, write := range []struct {
			name  string
			value any
		}{
			{name: "workflows", value: set.CreateWorkflows},
			{name: "tasks", value: set.CreateTasks},
			{name: "invocations", value: set.CreateInvocations},
			{name: "artifacts", value: set.CreateArtifacts},
			{name: "root proposals", value: set.CreateRootProposals},
			{name: "root final deliveries", value: set.CreateRootFinalDeliveries},
			{name: "workflow handoffs", value: set.CreateWorkflowHandoffs},
			{name: "queued inputs", value: set.CreateQueuedInputs},
		} {
			if isEmptyAgentProjectionSlice(write.value) {
				continue
			}
			if err := tx.Create(write.value).Error; err != nil {
				return fmt.Errorf("creating agent projection %s: %w", write.name, err)
			}
		}
		return nil
	})
	if err != nil {
		return AgentIdempotentEventResult{}, err
	}
	return result, nil
}

func applyProjectionCASWritesTx(tx *gorm.DB, set AgentProjectionWriteSet) error {
	for _, write := range set.UpdateWorkflows {
		result := tx.Model(&domain.AgentWorkflowModel{}).
			Where("project_id = ? AND id = ? AND revision = ?", strings.TrimSpace(write.Next.ProjectID), strings.TrimSpace(write.Next.ID), write.ExpectedRevision).
			Updates(workflowCASUpdates(write.Next, write.ExpectedRevision+1))
		if result.Error != nil {
			return fmt.Errorf("updating workflow projection: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
	}
	for _, write := range set.UpdateTasks {
		result := tx.Model(&domain.AgentTaskModel{}).
			Where("project_id = ? AND id = ? AND revision = ?", strings.TrimSpace(write.Next.ProjectID), strings.TrimSpace(write.Next.ID), write.ExpectedRevision).
			Updates(taskCASUpdates(write.Next, write.ExpectedRevision+1))
		if result.Error != nil {
			return fmt.Errorf("updating task projection: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
	}
	for _, write := range set.UpdateInvocations {
		allowedPrevious, ok := allowedPreviousInvocationStatuses(write.Next.Status)
		if !ok {
			return ErrAgentInvalidCAS
		}
		var current domain.AgentInvocationModel
		if err := tx.First(&current,
			"project_id = ? AND id = ? AND revision = ?",
			strings.TrimSpace(write.Next.ProjectID), strings.TrimSpace(write.Next.ID), write.ExpectedRevision,
		).Error; err != nil {
			if IsRecordNotFound(err) {
				return ErrAgentStaleRevision
			}
			return fmt.Errorf("reading invocation projection before update: %w", err)
		}
		if !containsString(allowedPrevious, current.Status) {
			return ErrAgentStaleRevision
		}
		result := tx.Model(&domain.AgentInvocationModel{}).
			Where("project_id = ? AND id = ? AND revision = ? AND status IN ?", strings.TrimSpace(write.Next.ProjectID), strings.TrimSpace(write.Next.ID), write.ExpectedRevision, allowedPrevious).
			Updates(invocationCASUpdates(write.Next, write.ExpectedRevision+1))
		if result.Error != nil {
			return fmt.Errorf("updating invocation projection: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
	}
	for _, write := range set.UpdateArtifacts {
		if write.ExpectedVersion == 0 {
			return ErrAgentInvalidCAS
		}
		result := tx.Model(&domain.AgentArtifactModel{}).
			Where("project_id = ? AND id = ? AND version = ?", strings.TrimSpace(write.Next.ProjectID), strings.TrimSpace(write.Next.ID), write.ExpectedVersion).
			Updates(artifactCASUpdates(write.Next, write.ExpectedVersion+1))
		if result.Error != nil {
			return fmt.Errorf("updating artifact projection: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
	}
	return nil
}

func isEmptyAgentProjectionSlice(value any) bool {
	switch rows := value.(type) {
	case []domain.AgentWorkflowModel:
		return len(rows) == 0
	case []domain.AgentTaskModel:
		return len(rows) == 0
	case []domain.AgentInvocationModel:
		return len(rows) == 0
	case []domain.AgentArtifactModel:
		return len(rows) == 0
	case []domain.AgentRootProposalModel:
		return len(rows) == 0
	case []domain.AgentRootFinalDeliveryModel:
		return len(rows) == 0
	case []domain.AgentWorkflowHandoffModel:
		return len(rows) == 0
	case []domain.AgentQueuedInputModel:
		return len(rows) == 0
	default:
		return true
	}
}

func createWorkflowEventTx(tx *gorm.DB, event domain.AgentWorkflowEventModel) (AgentIdempotentEventResult, error) {
	event.ProjectID = strings.TrimSpace(event.ProjectID)
	event.WorkflowID = strings.TrimSpace(event.WorkflowID)
	event.ID = strings.TrimSpace(event.ID)
	event.IdempotencyKey = strings.TrimSpace(event.IdempotencyKey)
	event.PayloadFingerprint = strings.TrimSpace(event.PayloadFingerprint)
	if event.ProjectID == "" || event.WorkflowID == "" || event.ID == "" || event.IdempotencyKey == "" || event.PayloadFingerprint == "" {
		return AgentIdempotentEventResult{}, ErrAgentInvalidCAS
	}
	var existing domain.AgentWorkflowEventModel
	err := tx.Where(
		"project_id = ? AND workflow_id = ? AND idempotency_key = ?",
		event.ProjectID,
		event.WorkflowID,
		event.IdempotencyKey,
	).First(&existing).Error
	if err == nil {
		if !sameWorkflowEventCommand(existing, event) {
			return AgentIdempotentEventResult{}, ErrAgentCommandConflict
		}
		return AgentIdempotentEventResult{Applied: false, Event: existing}, nil
	}
	if !IsRecordNotFound(err) {
		return AgentIdempotentEventResult{}, fmt.Errorf("checking agent workflow event command: %w", err)
	}
	if event.Sequence == 0 {
		sequence, sequenceErr := nextWorkflowEventSequenceTx(tx, event.ProjectID, event.WorkflowID)
		if sequenceErr != nil {
			return AgentIdempotentEventResult{}, sequenceErr
		}
		event.Sequence = sequence
	}
	if err := tx.Create(&event).Error; err != nil {
		// A concurrent winner may have committed between lookup and insert.
		var winner domain.AgentWorkflowEventModel
		lookupErr := tx.Where(
			"project_id = ? AND workflow_id = ? AND idempotency_key = ?",
			event.ProjectID,
			event.WorkflowID,
			event.IdempotencyKey,
		).First(&winner).Error
		if lookupErr == nil {
			if !sameWorkflowEventCommand(winner, event) {
				return AgentIdempotentEventResult{}, ErrAgentCommandConflict
			}
			return AgentIdempotentEventResult{Applied: false, Event: winner}, nil
		}
		return AgentIdempotentEventResult{}, fmt.Errorf("creating agent workflow event: %w", err)
	}
	return AgentIdempotentEventResult{Applied: true, Event: event}, nil
}

func sameWorkflowEventCommand(left domain.AgentWorkflowEventModel, right domain.AgentWorkflowEventModel) bool {
	return left.PayloadFingerprint == right.PayloadFingerprint &&
		left.PayloadJSON == right.PayloadJSON &&
		left.EventType == right.EventType &&
		left.EventVersion == right.EventVersion
}

// GetWorkflow returns a workflow by project and ID.
func (repo *AgentExecutionRepository) GetWorkflow(ctx context.Context, projectID string, workflowID string) (domain.AgentWorkflowModel, error) {
	var model domain.AgentWorkflowModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(workflowID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentWorkflowModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentWorkflowModel{}, fmt.Errorf("getting agent workflow: %w", err)
	}
	return model, nil
}

// GetTask returns a logical Agent task by project and ID.
func (repo *AgentExecutionRepository) GetTask(ctx context.Context, projectID string, taskID string) (domain.AgentTaskModel, error) {
	var model domain.AgentTaskModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(taskID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentTaskModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentTaskModel{}, fmt.Errorf("getting agent task: %w", err)
	}
	return model, nil
}

// GetInvocation returns an Agent invocation by project and ID.
func (repo *AgentExecutionRepository) GetInvocation(ctx context.Context, projectID string, invocationID string) (domain.AgentInvocationModel, error) {
	var model domain.AgentInvocationModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(invocationID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentInvocationModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentInvocationModel{}, fmt.Errorf("getting agent invocation: %w", err)
	}
	return model, nil
}

// GetArtifact returns a versioned Agent artifact by project and ID.
func (repo *AgentExecutionRepository) GetArtifact(ctx context.Context, projectID string, artifactID string) (domain.AgentArtifactModel, error) {
	var model domain.AgentArtifactModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(artifactID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentArtifactModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentArtifactModel{}, fmt.Errorf("getting agent artifact: %w", err)
	}
	return model, nil
}

// GetRootProposal returns an immutable root proposal by project and ID.
func (repo *AgentExecutionRepository) GetRootProposal(ctx context.Context, projectID string, proposalID string) (domain.AgentRootProposalModel, error) {
	var model domain.AgentRootProposalModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(proposalID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentRootProposalModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentRootProposalModel{}, fmt.Errorf("getting agent root proposal: %w", err)
	}
	return model, nil
}

// GetRootFinalDelivery returns a root-final outbox row scoped to project and session.
func (repo *AgentExecutionRepository) GetRootFinalDelivery(ctx context.Context, projectID string, sessionID string, deliveryID string) (domain.AgentRootFinalDeliveryModel, error) {
	var model domain.AgentRootFinalDeliveryModel
	err := repo.db.WithContext(ctx).First(
		&model,
		"project_id = ? AND session_id = ? AND id = ?",
		strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(deliveryID),
	).Error
	if IsRecordNotFound(err) {
		return domain.AgentRootFinalDeliveryModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentRootFinalDeliveryModel{}, fmt.Errorf("getting agent root final delivery: %w", err)
	}
	return model, nil
}

// GetWorkflowHandoff returns a replace handoff scoped to project and session.
func (repo *AgentExecutionRepository) GetWorkflowHandoff(ctx context.Context, projectID string, sessionID string, handoffID string) (domain.AgentWorkflowHandoffModel, error) {
	var model domain.AgentWorkflowHandoffModel
	err := repo.db.WithContext(ctx).First(
		&model,
		"project_id = ? AND session_id = ? AND id = ?",
		strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(handoffID),
	).Error
	if IsRecordNotFound(err) {
		return domain.AgentWorkflowHandoffModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentWorkflowHandoffModel{}, fmt.Errorf("getting agent workflow handoff: %w", err)
	}
	return model, nil
}

// GetQueuedInput returns a queued user input scoped to project and session.
func (repo *AgentExecutionRepository) GetQueuedInput(ctx context.Context, projectID string, sessionID string, queuedInputID string) (domain.AgentQueuedInputModel, error) {
	var model domain.AgentQueuedInputModel
	err := repo.db.WithContext(ctx).First(
		&model,
		"project_id = ? AND session_id = ? AND id = ?",
		strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(queuedInputID),
	).Error
	if IsRecordNotFound(err) {
		return domain.AgentQueuedInputModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentQueuedInputModel{}, fmt.Errorf("getting agent queued input: %w", err)
	}
	return model, nil
}

// GetWorkflowEvent returns an Agent workflow event by project and ID.
func (repo *AgentExecutionRepository) GetWorkflowEvent(ctx context.Context, projectID string, eventID string) (domain.AgentWorkflowEventModel, error) {
	var model domain.AgentWorkflowEventModel
	err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(eventID)).Error
	if IsRecordNotFound(err) {
		return domain.AgentWorkflowEventModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.AgentWorkflowEventModel{}, fmt.Errorf("getting agent workflow event: %w", err)
	}
	return model, nil
}

// PublishArtifactVersion atomically creates expected version zero as version
// one, or replaces expected version N with server-computed version N+1.
func (repo *AgentExecutionRepository) PublishArtifactVersion(
	ctx context.Context,
	model domain.AgentArtifactModel,
	expectedVersion uint64,
) (domain.AgentArtifactModel, bool, error) {
	model.ProjectID = strings.TrimSpace(model.ProjectID)
	model.ID = strings.TrimSpace(model.ID)
	model.WorkflowID = strings.TrimSpace(model.WorkflowID)
	if model.ProjectID == "" || model.ID == "" || model.WorkflowID == "" {
		return domain.AgentArtifactModel{}, false, ErrAgentInvalidCAS
	}
	if expectedVersion == 0 {
		model.Version = 1
		if err := repo.db.WithContext(ctx).Create(&model).Error; err != nil {
			var existing domain.AgentArtifactModel
			lookupErr := repo.db.WithContext(ctx).First(&existing, "project_id = ? AND id = ?", model.ProjectID, model.ID).Error
			if lookupErr == nil {
				if !sameArtifactCreate(existing, model) {
					return domain.AgentArtifactModel{}, false, ErrAgentCommandConflict
				}
				return existing, false, nil
			}
			return domain.AgentArtifactModel{}, false, fmt.Errorf("creating agent artifact: %w", err)
		}
		return model, true, nil
	}
	nextVersion := expectedVersion + 1
	result := repo.db.WithContext(ctx).Model(&domain.AgentArtifactModel{}).
		Where("project_id = ? AND id = ? AND version = ?", model.ProjectID, model.ID, expectedVersion).
		Updates(artifactCASUpdates(model, nextVersion))
	if result.Error != nil {
		return domain.AgentArtifactModel{}, false, fmt.Errorf("publishing agent artifact version: %w", result.Error)
	}
	var persisted domain.AgentArtifactModel
	if err := repo.db.WithContext(ctx).First(&persisted, "project_id = ? AND id = ?", model.ProjectID, model.ID).Error; err != nil {
		return domain.AgentArtifactModel{}, false, fmt.Errorf("reading agent artifact version: %w", err)
	}
	return persisted, result.RowsAffected == 1, nil
}

func sameArtifactCreate(left domain.AgentArtifactModel, right domain.AgentArtifactModel) bool {
	return left.WorkflowID == right.WorkflowID && left.ProducerTaskID == right.ProducerTaskID &&
		left.Kind == right.Kind && left.RefType == right.RefType && left.RefID == right.RefID &&
		left.RefVersion == right.RefVersion && left.RefFingerprint == right.RefFingerprint &&
		left.Status == right.Status && left.Title == right.Title && left.Summary == right.Summary &&
		left.MetadataJSON == right.MetadataJSON
}

// CompareAndSwapWorkflow replaces a workflow projection at an expected revision.
func (repo *AgentExecutionRepository) CompareAndSwapWorkflow(
	ctx context.Context,
	next domain.AgentWorkflowModel,
	expectedRevision uint64,
) (bool, error) {
	result := repo.db.WithContext(ctx).Model(&domain.AgentWorkflowModel{}).
		Where("project_id = ? AND id = ? AND revision = ?", strings.TrimSpace(next.ProjectID), strings.TrimSpace(next.ID), expectedRevision).
		Updates(workflowCASUpdates(next, expectedRevision+1))
	if result.Error != nil {
		return false, fmt.Errorf("compare-and-swap agent workflow: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// CompareAndSwapTask replaces a Task projection at an expected revision.
func (repo *AgentExecutionRepository) CompareAndSwapTask(
	ctx context.Context,
	next domain.AgentTaskModel,
	expectedRevision uint64,
) (bool, error) {
	result := repo.db.WithContext(ctx).Model(&domain.AgentTaskModel{}).
		Where("project_id = ? AND id = ? AND revision = ?", strings.TrimSpace(next.ProjectID), strings.TrimSpace(next.ID), expectedRevision).
		Updates(taskCASUpdates(next, expectedRevision+1))
	if result.Error != nil {
		return false, fmt.Errorf("compare-and-swap agent task: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// CompareAndSwapInvocation replaces an Invocation projection at an expected revision.
func (repo *AgentExecutionRepository) CompareAndSwapInvocation(
	ctx context.Context,
	next domain.AgentInvocationModel,
	expectedRevision uint64,
) (bool, error) {
	allowedPrevious, ok := allowedPreviousInvocationStatuses(next.Status)
	if !ok {
		return false, ErrAgentInvalidCAS
	}
	applied := false
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var current domain.AgentInvocationModel
		err := tx.First(&current,
			"project_id = ? AND id = ? AND revision = ?",
			strings.TrimSpace(next.ProjectID), strings.TrimSpace(next.ID), expectedRevision,
		).Error
		if IsRecordNotFound(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading invocation before compare-and-swap: %w", err)
		}
		if !containsString(allowedPrevious, current.Status) {
			return nil
		}
		result := tx.Model(&domain.AgentInvocationModel{}).
			Where("project_id = ? AND id = ? AND revision = ? AND status = ?", strings.TrimSpace(next.ProjectID), strings.TrimSpace(next.ID), expectedRevision, current.Status).
			Updates(invocationCASUpdates(next, expectedRevision+1))
		if result.Error != nil {
			return fmt.Errorf("compare-and-swap agent invocation: %w", result.Error)
		}
		applied = result.RowsAffected == 1
		return nil
	})
	if err != nil {
		return false, err
	}
	return applied, nil
}

func allowedPreviousInvocationStatuses(next string) ([]string, bool) {
	switch strings.TrimSpace(next) {
	case "pending":
		return []string{"pending"}, true
	case "running":
		return []string{"pending", "running"}, true
	case "completed":
		return []string{"pending", "running", "completed"}, true
	case "failed":
		return []string{"pending", "running", "failed"}, true
	case "cancelled":
		return []string{"pending", "running", "cancelled"}, true
	case "interrupted":
		return []string{"pending", "running", "interrupted"}, true
	default:
		return nil, false
	}
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func workflowCASUpdates(next domain.AgentWorkflowModel, revision uint64) map[string]any {
	return map[string]any{
		"session_id": next.SessionID, "root_task_id": next.RootTaskID, "status": next.Status,
		"goal_json": next.GoalJSON, "plan_json": next.PlanJSON, "goal_version": next.GoalVersion,
		"plan_version": next.PlanVersion, "revision": revision, "updated_at": next.UpdatedAt, "completed_at": next.CompletedAt,
	}
}

func taskCASUpdates(next domain.AgentTaskModel, revision uint64) map[string]any {
	return map[string]any{
		"workflow_id": next.WorkflowID, "parent_task_id": next.ParentTaskID, "role": next.Role,
		"name": next.Name, "task": next.Task, "status": next.Status, "current_action": next.CurrentAction,
		"revision": revision, "current_invocation_id": next.CurrentInvocationID,
		"last_invocation_status": next.LastInvocationStatus, "last_error_code": next.LastErrorCode,
		"started_at": next.StartedAt, "updated_at": next.UpdatedAt, "completed_at": next.CompletedAt,
		"metadata_json": next.MetadataJSON,
	}
}

func invocationCASUpdates(next domain.AgentInvocationModel, revision uint64) map[string]any {
	updates := map[string]any{
		"workflow_id": next.WorkflowID, "task_id": next.TaskID, "parent_invocation_id": next.ParentInvocationID,
		"run_id": next.RunID, "native_session_id": next.NativeSessionID, "native_thread_id": next.NativeThreadID,
		"native_tool_call_id": next.NativeToolCallID, "status": next.Status, "revision": revision,
		"started_at": next.StartedAt, "updated_at": next.UpdatedAt, "completed_at": next.CompletedAt,
		"metadata_json": next.MetadataJSON,
	}
	return updates
}

func artifactCASUpdates(next domain.AgentArtifactModel, version uint64) map[string]any {
	return map[string]any{
		"workflow_id": next.WorkflowID, "producer_task_id": next.ProducerTaskID, "version": version,
		"kind": next.Kind, "ref_type": next.RefType, "ref_id": next.RefID, "ref_version": next.RefVersion,
		"ref_fingerprint": next.RefFingerprint, "status": next.Status, "title": next.Title,
		"summary": next.Summary, "metadata_json": next.MetadataJSON, "updated_at": next.UpdatedAt,
	}
}

// ClaimContinuation leases an unacknowledged continuation with a new fence token.
func (repo *AgentExecutionRepository) ClaimContinuation(
	ctx context.Context,
	projectID string,
	eventID string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AgentWorkflowEventModel, bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(eventID) == "" || strings.TrimSpace(owner) == "" || !leaseUntil.After(now) {
		return domain.AgentWorkflowEventModel{}, false, ErrAgentInvalidCAS
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentWorkflowEventModel{}).
		Where("project_id = ? AND id = ? AND delivery_id IS NOT NULL", strings.TrimSpace(projectID), strings.TrimSpace(eventID)).
		Where("delivery_status IN ?", []string{"pending", "leased", "delivered"}).
		Where("lease_until IS NULL OR lease_until <= ?", now.UTC()).
		Where("next_attempt_at IS NULL OR next_attempt_at <= ?", now.UTC()).
		Updates(map[string]any{
			"delivery_status": "leased",
			"lease_owner":     strings.TrimSpace(owner),
			"lease_until":     leaseUntil.UTC(),
			"lease_token":     gorm.Expr("lease_token + 1"),
			"attempt":         gorm.Expr("attempt + 1"),
		})
	if result.Error != nil {
		return domain.AgentWorkflowEventModel{}, false, fmt.Errorf("claiming agent continuation: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return domain.AgentWorkflowEventModel{}, false, nil
	}
	model, err := repo.GetWorkflowEvent(ctx, projectID, eventID)
	if err != nil {
		return domain.AgentWorkflowEventModel{}, false, err
	}
	return model, true, nil
}

// MarkContinuationDelivered records that a leased delivery crossed the runner boundary.
func (repo *AgentExecutionRepository) MarkContinuationDelivered(
	ctx context.Context,
	projectID string,
	eventID string,
	owner string,
	leaseToken uint64,
	deliveredAt time.Time,
) (bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(eventID) == "" || strings.TrimSpace(owner) == "" || leaseToken == 0 || deliveredAt.IsZero() {
		return false, ErrAgentInvalidCAS
	}
	return repo.transitionContinuation(ctx, projectID, eventID, "leased", "delivered", owner, leaseToken, deliveredAt, map[string]any{
		"delivered_at": deliveredAt.UTC(),
	})
}

// AckContinuation records a durable successful terminal receipt.
func (repo *AgentExecutionRepository) AckContinuation(
	ctx context.Context,
	projectID string,
	eventID string,
	owner string,
	leaseToken uint64,
	ackedAt time.Time,
) (bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(eventID) == "" || strings.TrimSpace(owner) == "" || leaseToken == 0 || ackedAt.IsZero() {
		return false, ErrAgentInvalidCAS
	}
	return repo.transitionContinuation(ctx, projectID, eventID, "delivered", "acked", owner, leaseToken, ackedAt, map[string]any{
		"acked_at": ackedAt.UTC(), "lease_owner": nil, "lease_until": nil,
	})
}

func (repo *AgentExecutionRepository) transitionContinuation(
	ctx context.Context,
	projectID string,
	eventID string,
	expectedStatus string,
	nextStatus string,
	owner string,
	leaseToken uint64,
	at time.Time,
	extra map[string]any,
) (bool, error) {
	updates := map[string]any{"delivery_status": nextStatus}
	for key, value := range extra {
		updates[key] = value
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentWorkflowEventModel{}).
		Where(
			"project_id = ? AND id = ? AND delivery_status = ? AND lease_owner = ? AND lease_token = ? AND lease_until > ?",
			strings.TrimSpace(projectID), strings.TrimSpace(eventID), expectedStatus, strings.TrimSpace(owner), leaseToken, at.UTC(),
		).
		Updates(updates)
	if result.Error != nil {
		return false, fmt.Errorf("transitioning agent continuation: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// DiscardContinuation invalidates any continuation that has not been acked or discarded.
func (repo *AgentExecutionRepository) DiscardContinuation(
	ctx context.Context,
	projectID string,
	eventID string,
	reason string,
	discardedAt time.Time,
) (bool, error) {
	result := repo.db.WithContext(ctx).Model(&domain.AgentWorkflowEventModel{}).
		Where("project_id = ? AND id = ? AND delivery_id IS NOT NULL", strings.TrimSpace(projectID), strings.TrimSpace(eventID)).
		Where("delivery_status NOT IN ?", []string{"acked", "discarded"}).
		Updates(map[string]any{
			"delivery_status": "discarded", "discard_reason": strings.TrimSpace(reason), "discarded_at": discardedAt.UTC(),
			"lease_owner": nil, "lease_until": nil, "lease_token": gorm.Expr("lease_token + 1"),
		})
	if result.Error != nil {
		return false, fmt.Errorf("discarding agent continuation: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// ClaimRootFinalDelivery leases only automatically publishable deliveries.
// Failed deliveries stay in the recovery-issue bucket until a recovery service
// has independently verified the journal and supplies a fenced reconcile CAS.
func (repo *AgentExecutionRepository) ClaimRootFinalDelivery(
	ctx context.Context,
	projectID string,
	sessionID string,
	deliveryID string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AgentRootFinalDeliveryModel, bool, error) {
	return repo.claimRootFinalDelivery(ctx, projectID, sessionID, deliveryID, owner, now, leaseUntil, []string{"pending", "journaled"})
}

// ClaimFailedRootFinalDeliveryForReconcile fences a failed delivery after the
// caller has performed the full journal verification required for recovery.
// Keeping this operation separate prevents the ordinary publisher loop from
// treating failed rows as automatically retryable.
func (repo *AgentExecutionRepository) ClaimFailedRootFinalDeliveryForReconcile(
	ctx context.Context,
	projectID string,
	sessionID string,
	deliveryID string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AgentRootFinalDeliveryModel, bool, error) {
	return repo.claimRootFinalDelivery(ctx, projectID, sessionID, deliveryID, owner, now, leaseUntil, []string{"failed"})
}

func (repo *AgentExecutionRepository) claimRootFinalDelivery(
	ctx context.Context,
	projectID string,
	sessionID string,
	deliveryID string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
	phases []string,
) (domain.AgentRootFinalDeliveryModel, bool, error) {
	if strings.TrimSpace(owner) == "" || !leaseUntil.After(now) {
		return domain.AgentRootFinalDeliveryModel{}, false, ErrAgentInvalidCAS
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentRootFinalDeliveryModel{}).
		Where("project_id = ? AND session_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(deliveryID)).
		Where("phase IN ?", phases).
		Where("lease_until IS NULL OR lease_until <= ?", now.UTC()).
		Where("next_attempt_at IS NULL OR next_attempt_at <= ?", now.UTC()).
		Updates(map[string]any{
			"lease_owner": strings.TrimSpace(owner), "lease_until": leaseUntil.UTC(),
			"lease_token": gorm.Expr("lease_token + 1"), "attempt": gorm.Expr("attempt + 1"),
		})
	if result.Error != nil {
		return domain.AgentRootFinalDeliveryModel{}, false, fmt.Errorf("claiming root final delivery: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return domain.AgentRootFinalDeliveryModel{}, false, nil
	}
	var model domain.AgentRootFinalDeliveryModel
	if err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND session_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(deliveryID)).Error; err != nil {
		return domain.AgentRootFinalDeliveryModel{}, false, fmt.Errorf("reading claimed root final delivery: %w", err)
	}
	return model, true, nil
}

// TransitionRootFinalDelivery applies a fenced phase/revision CAS and records
// the first result under the command ID in the same transaction.
func (repo *AgentExecutionRepository) TransitionRootFinalDelivery(
	ctx context.Context,
	input AgentRootFinalDeliveryTransition,
) (AgentCommandResult, error) {
	if err := validateFencedCommand(input.ProjectID, input.SessionID, input.DeliveryID, input.ExpectedPhase, input.NextPhase, input.LeaseOwner, input.LeaseToken, input.CommandID, input.CommandFingerprint); err != nil {
		return AgentCommandResult{}, err
	}
	if input.ExpectedRevision == 0 || input.At.IsZero() || !allowedRootFinalTransition(input.ExpectedPhase, input.NextPhase) || !validRootFinalSequenceTransition(input) {
		return AgentCommandResult{}, ErrAgentInvalidCAS
	}
	var output AgentCommandResult
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var delivery domain.AgentRootFinalDeliveryModel
		err := tx.First(&delivery,
			"project_id = ? AND session_id = ? AND id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.SessionID), strings.TrimSpace(input.DeliveryID),
		).Error
		if IsRecordNotFound(err) {
			return ErrAgentStaleRevision
		}
		if err != nil {
			return fmt.Errorf("reading root final delivery transition: %w", err)
		}
		idempotencyKey := "root-final:" + delivery.ID + ":" + strings.TrimSpace(input.CommandID)
		if replay, found, err := findCommandResultTx(tx, delivery.ProjectID, delivery.WorkflowID, idempotencyKey, input.CommandFingerprint); err != nil {
			return err
		} else if found {
			output = replay
			return nil
		}
		if delivery.LeaseToken != input.LeaseToken || domain.StringValue(delivery.LeaseOwner) != strings.TrimSpace(input.LeaseOwner) {
			return ErrAgentStaleFence
		}
		if delivery.LeaseUntil == nil || !delivery.LeaseUntil.After(input.At) {
			return ErrAgentStaleFence
		}
		if delivery.Revision != input.ExpectedRevision || delivery.Phase != strings.TrimSpace(input.ExpectedPhase) {
			return ErrAgentStaleRevision
		}
		nextRevision := input.ExpectedRevision + 1
		updates := rootFinalTransitionUpdates(input, nextRevision)
		result := tx.Model(&domain.AgentRootFinalDeliveryModel{}).
			Where(
				"project_id = ? AND session_id = ? AND id = ? AND phase = ? AND revision = ? AND lease_owner = ? AND lease_token = ? AND lease_until > ?",
				delivery.ProjectID, delivery.SessionID, delivery.ID, input.ExpectedPhase, input.ExpectedRevision, input.LeaseOwner, input.LeaseToken, input.At.UTC(),
			).
			Updates(updates)
		if result.Error != nil {
			return fmt.Errorf("transitioning root final delivery: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		commandEvent, err := newCommandResultEvent(tx, delivery.ProjectID, delivery.WorkflowID, idempotencyKey, "agent.root_final_delivery.transitioned", input.CommandFingerprint, input.ResultJSON, nextRevision, input.At)
		if err != nil {
			return err
		}
		if err := tx.Create(&commandEvent).Error; err != nil {
			return fmt.Errorf("recording root final delivery command result: %w", err)
		}
		output = AgentCommandResult{Applied: true, Revision: nextRevision, ResultJSON: input.ResultJSON}
		return nil
	})
	if err != nil {
		return AgentCommandResult{}, err
	}
	return output, nil
}

func validRootFinalSequenceTransition(input AgentRootFinalDeliveryTransition) bool {
	hasRange := input.JSONLFirstSequence != 0 || input.JSONLLastSequence != 0
	if hasRange && (input.JSONLFirstSequence == 0 || input.JSONLLastSequence < input.JSONLFirstSequence) {
		return false
	}
	if strings.TrimSpace(input.NextPhase) == "journaled" {
		return hasRange
	}
	return !hasRange
}

func allowedRootFinalTransition(from string, to string) bool {
	to = strings.TrimSpace(to)
	switch strings.TrimSpace(from) {
	case "pending":
		return to == "journaled" || to == "failed"
	case "journaled":
		return to == "published" || to == "failed"
	case "failed":
		return to == "pending" || to == "journaled"
	default:
		return false
	}
}

func rootFinalTransitionUpdates(input AgentRootFinalDeliveryTransition, nextRevision uint64) map[string]any {
	at := input.At.UTC()
	updates := map[string]any{
		"phase": input.NextPhase, "revision": nextRevision, "failure_code": strings.TrimSpace(input.FailureCode),
		"last_error": input.LastError, "next_attempt_at": input.NextAttemptAt,
	}
	if input.JSONLFirstSequence != 0 || input.JSONLLastSequence != 0 {
		updates["jsonl_first_sequence"] = input.JSONLFirstSequence
		updates["jsonl_last_sequence"] = input.JSONLLastSequence
	}
	switch strings.TrimSpace(input.NextPhase) {
	case "journaled":
		updates["journaled_at"] = at
	case "published":
		updates["published_at"] = at
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
	case "pending", "failed":
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
		updates["lease_token"] = gorm.Expr("lease_token + 1")
	}
	return updates
}

// ClaimWorkflowHandoff applies a lease/fence without changing the independent
// semantic revision. Pending dispatch claims enter leased; reconcile claims
// retain sending/unknown so remote uncertainty is never erased.
func (repo *AgentExecutionRepository) ClaimWorkflowHandoff(
	ctx context.Context,
	projectID string,
	sessionID string,
	handoffID string,
	leaseMode string,
	expectedStatuses []string,
	owner string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AgentWorkflowHandoffModel, bool, error) {
	if len(expectedStatuses) == 0 || strings.TrimSpace(owner) == "" || !leaseUntil.After(now) || !allowedHandoffClaim(leaseMode, expectedStatuses) {
		return domain.AgentWorkflowHandoffModel{}, false, ErrAgentInvalidCAS
	}
	result := repo.db.WithContext(ctx).Model(&domain.AgentWorkflowHandoffModel{}).
		Where("project_id = ? AND session_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(handoffID)).
		Where("status IN ?", expectedStatuses).
		Where("lease_until IS NULL OR lease_until <= ?", now.UTC()).
		Where("next_attempt_at IS NULL OR next_attempt_at <= ?", now.UTC()).
		Updates(map[string]any{
			"status":     gorm.Expr("CASE WHEN status IN ('pending', 'leased') THEN 'leased' ELSE status END"),
			"lease_mode": strings.TrimSpace(leaseMode), "lease_owner": strings.TrimSpace(owner), "lease_until": leaseUntil.UTC(),
			"lease_token": gorm.Expr("lease_token + 1"), "technical_attempt_count": gorm.Expr("technical_attempt_count + 1"),
		})
	if result.Error != nil {
		return domain.AgentWorkflowHandoffModel{}, false, fmt.Errorf("claiming workflow handoff: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return domain.AgentWorkflowHandoffModel{}, false, nil
	}
	var model domain.AgentWorkflowHandoffModel
	if err := repo.db.WithContext(ctx).First(&model, "project_id = ? AND session_id = ? AND id = ?", strings.TrimSpace(projectID), strings.TrimSpace(sessionID), strings.TrimSpace(handoffID)).Error; err != nil {
		return domain.AgentWorkflowHandoffModel{}, false, fmt.Errorf("reading claimed workflow handoff: %w", err)
	}
	return model, true, nil
}

// TransitionWorkflowHandoff applies a fenced status/revision CAS and persists
// the first command result atomically.
func (repo *AgentExecutionRepository) TransitionWorkflowHandoff(
	ctx context.Context,
	input AgentWorkflowHandoffTransition,
) (AgentCommandResult, error) {
	if err := validateFencedCommand(input.ProjectID, input.SessionID, input.HandoffID, input.ExpectedStatus, input.NextStatus, input.LeaseOwner, input.LeaseToken, input.CommandID, input.CommandFingerprint); err != nil {
		return AgentCommandResult{}, err
	}
	if input.ExpectedRevision == 0 || input.At.IsZero() || !allowedHandoffTransition(input.ExpectedStatus, input.NextStatus) {
		return AgentCommandResult{}, ErrAgentInvalidCAS
	}
	var output AgentCommandResult
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var handoff domain.AgentWorkflowHandoffModel
		err := tx.First(&handoff,
			"project_id = ? AND session_id = ? AND id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.SessionID), strings.TrimSpace(input.HandoffID),
		).Error
		if IsRecordNotFound(err) {
			return ErrAgentStaleRevision
		}
		if err != nil {
			return fmt.Errorf("reading workflow handoff transition: %w", err)
		}
		idempotencyKey := "handoff:" + handoff.ID + ":" + strings.TrimSpace(input.CommandID)
		if replay, found, err := findCommandResultTx(tx, handoff.ProjectID, handoff.PredecessorWorkflowID, idempotencyKey, input.CommandFingerprint); err != nil {
			return err
		} else if found {
			output = replay
			return nil
		}
		if strings.TrimSpace(input.NextStatus) == "pending" && handoff.LeaseMode != "reconcile_only" {
			return ErrAgentInvalidCAS
		}
		if handoff.LeaseToken != input.LeaseToken || domain.StringValue(handoff.LeaseOwner) != strings.TrimSpace(input.LeaseOwner) {
			return ErrAgentStaleFence
		}
		if handoff.LeaseUntil == nil || !handoff.LeaseUntil.After(input.At) {
			return ErrAgentStaleFence
		}
		if handoff.Revision != input.ExpectedRevision || handoff.Status != strings.TrimSpace(input.ExpectedStatus) {
			return ErrAgentStaleRevision
		}
		nextRevision := input.ExpectedRevision + 1
		updates := handoffTransitionUpdates(input, nextRevision)
		result := tx.Model(&domain.AgentWorkflowHandoffModel{}).
			Where(
				"project_id = ? AND session_id = ? AND id = ? AND status = ? AND revision = ? AND lease_owner = ? AND lease_token = ? AND lease_until > ?",
				handoff.ProjectID, handoff.SessionID, handoff.ID, input.ExpectedStatus, input.ExpectedRevision, input.LeaseOwner, input.LeaseToken, input.At.UTC(),
			).
			Updates(updates)
		if result.Error != nil {
			return fmt.Errorf("transitioning workflow handoff: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		commandEvent, err := newCommandResultEvent(tx, handoff.ProjectID, handoff.PredecessorWorkflowID, idempotencyKey, "agent.workflow_handoff.transitioned", input.CommandFingerprint, input.ResultJSON, nextRevision, input.At)
		if err != nil {
			return err
		}
		if err := tx.Create(&commandEvent).Error; err != nil {
			return fmt.Errorf("recording workflow handoff command result: %w", err)
		}
		output = AgentCommandResult{Applied: true, Revision: nextRevision, ResultJSON: input.ResultJSON}
		return nil
	})
	if err != nil {
		return AgentCommandResult{}, err
	}
	return output, nil
}

func allowedHandoffClaim(mode string, statuses []string) bool {
	allowed := map[string]bool{}
	switch strings.TrimSpace(mode) {
	case "dispatch":
		allowed["pending"] = true
		allowed["leased"] = true
	case "reconcile_only":
		allowed["sending"] = true
		allowed["unknown"] = true
	default:
		return false
	}
	for _, status := range statuses {
		if !allowed[strings.TrimSpace(status)] {
			return false
		}
	}
	return true
}

func allowedHandoffTransition(from string, to string) bool {
	to = strings.TrimSpace(to)
	switch strings.TrimSpace(from) {
	case "leased":
		return to == "sending" || to == "cancelled" || to == "failed_definite"
	case "sending":
		return to == "started" || to == "unknown" || to == "pending"
	case "unknown":
		return to == "started" || to == "cancelled" || to == "pending"
	default:
		return false
	}
}

func handoffTransitionUpdates(input AgentWorkflowHandoffTransition, nextRevision uint64) map[string]any {
	at := input.At.UTC()
	updates := map[string]any{
		"status": input.NextStatus, "revision": nextRevision, "last_error": input.LastError,
		"next_attempt_at": input.NextAttemptAt,
	}
	if strings.TrimSpace(input.RemoteMessageID) != "" {
		updates["remote_message_id"] = input.RemoteMessageID
	}
	if strings.TrimSpace(input.RemoteCorrelation) != "" {
		updates["remote_correlation"] = input.RemoteCorrelation
	}
	switch strings.TrimSpace(input.NextStatus) {
	case "sending":
		updates["send_started_at"] = at
	case "started":
		updates["started_at"] = at
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
	case "unknown":
		updates["unknown_at"] = at
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
	case "failed_definite":
		updates["failed_at"] = at
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
		updates["lease_token"] = gorm.Expr("lease_token + 1")
	case "cancelled":
		updates["cancelled_at"] = at
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
		updates["lease_token"] = gorm.Expr("lease_token + 1")
	case "pending":
		updates["lease_owner"] = nil
		updates["lease_until"] = nil
		updates["lease_token"] = gorm.Expr("lease_token + 1")
	}
	return updates
}

func validateFencedCommand(values ...any) error {
	if len(values) != 9 {
		return ErrAgentInvalidCAS
	}
	for index, value := range values {
		if index == 6 {
			if token, ok := value.(uint64); !ok || token == 0 {
				return ErrAgentInvalidCAS
			}
			continue
		}
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return ErrAgentInvalidCAS
		}
	}
	return nil
}

func findCommandResultTx(
	tx *gorm.DB,
	projectID string,
	workflowID string,
	idempotencyKey string,
	fingerprint string,
) (AgentCommandResult, bool, error) {
	var event domain.AgentWorkflowEventModel
	err := tx.Where(
		"project_id = ? AND workflow_id = ? AND idempotency_key = ?",
		projectID,
		workflowID,
		idempotencyKey,
	).First(&event).Error
	if IsRecordNotFound(err) {
		return AgentCommandResult{}, false, nil
	}
	if err != nil {
		return AgentCommandResult{}, false, fmt.Errorf("reading agent command result: %w", err)
	}
	if event.PayloadFingerprint != strings.TrimSpace(fingerprint) {
		return AgentCommandResult{}, false, ErrAgentCommandConflict
	}
	return AgentCommandResult{Applied: false, Revision: event.CommandResultRevision, ResultJSON: event.PayloadJSON}, true, nil
}

func newCommandResultEvent(
	tx *gorm.DB,
	projectID string,
	workflowID string,
	idempotencyKey string,
	eventType string,
	fingerprint string,
	resultJSON string,
	revision uint64,
	at time.Time,
) (domain.AgentWorkflowEventModel, error) {
	digest := sha256.Sum256([]byte(projectID + "\x00" + workflowID + "\x00" + idempotencyKey))
	sequence, err := nextWorkflowEventSequenceTx(tx, projectID, workflowID)
	if err != nil {
		return domain.AgentWorkflowEventModel{}, err
	}
	return domain.AgentWorkflowEventModel{
		ProjectID:             projectID,
		ID:                    fmt.Sprintf("command-%x", digest[:16]),
		WorkflowID:            workflowID,
		Sequence:              sequence,
		EventType:             eventType,
		EventVersion:          1,
		PayloadJSON:           resultJSON,
		PayloadFingerprint:    strings.TrimSpace(fingerprint),
		IdempotencyKey:        idempotencyKey,
		CommandResultRevision: revision,
		CreatedAt:             at.UTC(),
	}, nil
}

func nextWorkflowEventSequenceTx(tx *gorm.DB, projectID string, workflowID string) (uint64, error) {
	var sequence uint64
	if err := tx.Model(&domain.AgentWorkflowEventModel{}).
		Select("COALESCE(MAX(sequence), 0) + 1").
		Where("project_id = ? AND workflow_id = ?", projectID, workflowID).
		Scan(&sequence).Error; err != nil {
		return 0, fmt.Errorf("allocating agent workflow event sequence: %w", err)
	}
	if sequence == 0 {
		return 1, nil
	}
	return sequence, nil
}

// CreateRootProposal inserts one immutable proposal per workflow command.
func (repo *AgentExecutionRepository) CreateRootProposal(
	ctx context.Context,
	proposal domain.AgentRootProposalModel,
) (domain.AgentRootProposalModel, bool, error) {
	proposal.ProjectID = strings.TrimSpace(proposal.ProjectID)
	proposal.ID = strings.TrimSpace(proposal.ID)
	proposal.WorkflowID = strings.TrimSpace(proposal.WorkflowID)
	proposal.CommandID = strings.TrimSpace(proposal.CommandID)
	proposal.CommandFingerprint = strings.TrimSpace(proposal.CommandFingerprint)
	proposal.OriginRootInvocationID = strings.TrimSpace(proposal.OriginRootInvocationID)
	if strings.TrimSpace(proposal.Status) == "" {
		proposal.Status = "pending"
	}
	if proposal.ProjectID == "" || proposal.ID == "" || proposal.WorkflowID == "" || proposal.CommandID == "" || proposal.CommandFingerprint == "" || proposal.OriginRootInvocationID == "" || strings.TrimSpace(proposal.Action) == "" || strings.TrimSpace(proposal.PayloadJSON) == "" || strings.TrimSpace(proposal.AuthenticatedOriginJSON) == "" || proposal.Status != "pending" {
		return domain.AgentRootProposalModel{}, false, ErrAgentInvalidCAS
	}
	var output domain.AgentRootProposalModel
	applied := false
	err := runAgentWorkflowTransaction(ctx, repo.db, func(tx *gorm.DB) error {
		var existing domain.AgentRootProposalModel
		err := tx.Where(
			"project_id = ? AND workflow_id = ? AND command_id = ?",
			proposal.ProjectID, proposal.WorkflowID, proposal.CommandID,
		).First(&existing).Error
		if err == nil {
			if !sameRootProposalCommand(existing, proposal) {
				return ErrAgentCommandConflict
			}
			output = existing
			return nil
		}
		if !IsRecordNotFound(err) {
			return fmt.Errorf("checking root proposal: %w", err)
		}
		if err := tx.Create(&proposal).Error; err != nil {
			return fmt.Errorf("creating root proposal: %w", err)
		}
		output = proposal
		applied = true
		return nil
	})
	if err != nil {
		return domain.AgentRootProposalModel{}, false, err
	}
	return output, applied, nil
}

func sameRootProposalCommand(left domain.AgentRootProposalModel, right domain.AgentRootProposalModel) bool {
	return left.CommandFingerprint == right.CommandFingerprint &&
		left.Action == right.Action &&
		left.PayloadJSON == right.PayloadJSON &&
		left.AuthenticatedOriginJSON == right.AuthenticatedOriginJSON &&
		left.OriginRootInvocationID == right.OriginRootInvocationID &&
		left.ProposerTaskID == right.ProposerTaskID &&
		left.ProposerInvocationID == right.ProposerInvocationID &&
		sameOptionalUint64(left.ExpectedGoalVersion, right.ExpectedGoalVersion) &&
		sameOptionalUint64(left.ExpectedPlanVersion, right.ExpectedPlanVersion) &&
		sameOptionalUint64(left.ExpectedTaskRevision, right.ExpectedTaskRevision)
}

func sameOptionalUint64(left *uint64, right *uint64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// ListPendingRootProposals lists immutable pending proposals for one root invocation.
func (repo *AgentExecutionRepository) ListPendingRootProposals(
	ctx context.Context,
	projectID string,
	workflowID string,
	originRootInvocationID string,
) ([]domain.AgentRootProposalModel, error) {
	models := []domain.AgentRootProposalModel{}
	if err := repo.db.WithContext(ctx).
		Where(
			"project_id = ? AND workflow_id = ? AND origin_root_invocation_id = ? AND status = ?",
			strings.TrimSpace(projectID), strings.TrimSpace(workflowID), strings.TrimSpace(originRootInvocationID), "pending",
		).
		Order("proposed_at ASC, id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing pending root proposals: %w", err)
	}
	return models, nil
}

// ListRecoverable returns durable records that recovery services may inspect.
func (repo *AgentExecutionRepository) ListRecoverable(ctx context.Context, projectID string) (AgentRecoverableState, error) {
	projectID = strings.TrimSpace(projectID)
	state := AgentRecoverableState{
		ActiveWorkflows:                []domain.AgentWorkflowModel{},
		Continuations:                  []domain.AgentWorkflowEventModel{},
		PublishableRootFinalDeliveries: []domain.AgentRootFinalDeliveryModel{},
		FailedRootFinalDeliveries:      []domain.AgentRootFinalDeliveryModel{},
		WorkflowHandoffs:               []domain.AgentWorkflowHandoffModel{},
	}
	if err := repo.db.WithContext(ctx).Where("project_id = ? AND status = ?", projectID, "active").Order("created_at ASC").Find(&state.ActiveWorkflows).Error; err != nil {
		return AgentRecoverableState{}, fmt.Errorf("listing recoverable workflows: %w", err)
	}
	if err := repo.db.WithContext(ctx).
		Where("project_id = ? AND delivery_id IS NOT NULL AND delivery_status IN ?", projectID, []string{"pending", "leased", "delivered"}).
		Order("created_at ASC").Find(&state.Continuations).Error; err != nil {
		return AgentRecoverableState{}, fmt.Errorf("listing recoverable continuations: %w", err)
	}
	if err := repo.db.WithContext(ctx).
		Where("project_id = ? AND phase IN ?", projectID, []string{"pending", "journaled"}).
		Order("created_at ASC").Find(&state.PublishableRootFinalDeliveries).Error; err != nil {
		return AgentRecoverableState{}, fmt.Errorf("listing publishable root final deliveries: %w", err)
	}
	if err := repo.db.WithContext(ctx).
		Where("project_id = ? AND phase = ?", projectID, "failed").
		Order("created_at ASC").Find(&state.FailedRootFinalDeliveries).Error; err != nil {
		return AgentRecoverableState{}, fmt.Errorf("listing failed root final deliveries: %w", err)
	}
	if err := repo.db.WithContext(ctx).
		Where("project_id = ? AND status IN ?", projectID, []string{"pending", "leased", "sending", "unknown"}).
		Order("created_at ASC").Find(&state.WorkflowHandoffs).Error; err != nil {
		return AgentRecoverableState{}, fmt.Errorf("listing recoverable workflow handoffs: %w", err)
	}
	return state, nil
}
