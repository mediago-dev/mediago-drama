package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

// AgentWorkflowUnitOfWork is the sole repository transaction owner for
// creating, terminating, and replacing Workflow scopes.
type AgentWorkflowUnitOfWork struct {
	db *gorm.DB
}

// NewAgentWorkflowUnitOfWork creates the Workflow transaction owner.
func NewAgentWorkflowUnitOfWork(db *gorm.DB) *AgentWorkflowUnitOfWork {
	return &AgentWorkflowUnitOfWork{db: db}
}

// AgentWorkflowEnvelopeInput contains precomputed stable identities for a new root envelope.
type AgentWorkflowEnvelopeInput struct {
	ProjectID          string
	SessionID          string
	CommandID          string
	CommandFingerprint string
	Workflow           domain.AgentWorkflowModel
	RootTask           domain.AgentTaskModel
	RootInvocation     domain.AgentInvocationModel
}

// AgentWorkflowEnvelopeResult returns the single active Workflow selected by session CAS.
type AgentWorkflowEnvelopeResult struct {
	Applied      bool
	WorkflowID   string
	RootTaskID   string
	InvocationID string
	RunID        string
}

// AgentWorkflowReplaceInput contains service-authorized, fully computed replace projections.
type AgentWorkflowReplaceInput struct {
	ProjectID                   string
	SessionID                   string
	PredecessorWorkflowID       string
	ExpectedPredecessorRevision uint64
	CommandID                   string
	CommandFingerprint          string
	CompletedAt                 time.Time
	SuccessorWorkflow           domain.AgentWorkflowModel
	SuccessorRootTask           domain.AgentTaskModel
	SuccessorRootInvocation     domain.AgentInvocationModel
	PredecessorFinalDelivery    domain.AgentRootFinalDeliveryModel
	Handoff                     domain.AgentWorkflowHandoffModel
}

// AgentWorkflowReplaceResult returns the stable result of a replace command.
type AgentWorkflowReplaceResult struct {
	Applied                    bool
	SuccessorWorkflowID        string
	SuccessorRootTaskID        string
	SuccessorRootInvocationID  string
	SuccessorRunID             string
	HandoffID                  string
	PredecessorFinalDeliveryID string
}

// AgentWorkflowTerminateInput contains a service-authorized scope termination.
type AgentWorkflowTerminateInput struct {
	ProjectID          string
	SessionID          string
	WorkflowID         string
	ExpectedRevision   uint64
	CommandID          string
	CommandFingerprint string
	TerminalStatus     string
	Reason             string
	CompletedAt        time.Time
}

// AgentWorkflowTerminateResult returns the stable terminal workflow revision.
type AgentWorkflowTerminateResult struct {
	Applied    bool
	WorkflowID string
	Revision   uint64
}

// CreateWorkflowEnvelope atomically creates the Workflow, root Task and root
// Invocation only if the session still has no active Workflow or final barrier.
func (uow *AgentWorkflowUnitOfWork) CreateWorkflowEnvelope(
	ctx context.Context,
	input AgentWorkflowEnvelopeInput,
) (AgentWorkflowEnvelopeResult, error) {
	if err := validateWorkflowEnvelope(input); err != nil {
		return AgentWorkflowEnvelopeResult{}, err
	}
	var output AgentWorkflowEnvelopeResult
	err := runAgentWorkflowTransaction(ctx, uow.db, func(tx *gorm.DB) error {
		if replay, found, err := findWorkflowEnvelopeReplayTx(tx, input); err != nil {
			return err
		} else if found {
			output = replay
			return nil
		}
		var session domain.AgentSessionModel
		if err := tx.First(&session,
			"project_id = ? AND session_id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.SessionID),
		).Error; err != nil {
			if IsRecordNotFound(err) {
				return ErrAgentStaleRevision
			}
			return fmt.Errorf("reading session for workflow envelope: %w", err)
		}
		if session.ActiveWorkflowID != nil {
			var existingCommand domain.AgentWorkflowEventModel
			err := tx.Where(
				"project_id = ? AND workflow_id = ? AND idempotency_key = ?",
				session.ProjectID,
				domain.StringValue(session.ActiveWorkflowID),
				"workflow-envelope:"+strings.TrimSpace(input.CommandID),
			).First(&existingCommand).Error
			if err == nil && existingCommand.PayloadFingerprint != strings.TrimSpace(input.CommandFingerprint) {
				return ErrAgentCommandConflict
			}
			if err != nil && !IsRecordNotFound(err) {
				return fmt.Errorf("checking workflow envelope command: %w", err)
			}
			return loadActiveEnvelopeResultTx(tx, session.ProjectID, domain.StringValue(session.ActiveWorkflowID), &output)
		}
		if session.PendingFinalDeliveryID != nil {
			return ErrAgentStaleRevision
		}

		workflow := input.Workflow
		rootTask := input.RootTask
		rootInvocation := input.RootInvocation
		if rootTask.CurrentInvocationID == nil {
			rootTask.CurrentInvocationID = domain.StringPtr(rootInvocation.ID)
		}
		if err := tx.Create(&workflow).Error; err != nil {
			return fmt.Errorf("creating workflow envelope workflow: %w", err)
		}
		if err := tx.Create(&rootTask).Error; err != nil {
			return fmt.Errorf("creating workflow envelope root task: %w", err)
		}
		if err := tx.Create(&rootInvocation).Error; err != nil {
			return fmt.Errorf("creating workflow envelope root invocation: %w", err)
		}
		result := tx.Model(&domain.AgentSessionModel{}).
			Where(
				"project_id = ? AND session_id = ? AND revision = ? AND active_workflow_id IS NULL AND pending_final_delivery_id IS NULL",
				session.ProjectID, session.SessionID, session.Revision,
			).
			Updates(map[string]any{
				"active_workflow_id": workflow.ID,
				"revision":           session.Revision + 1,
			})
		if result.Error != nil {
			return fmt.Errorf("activating workflow envelope: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return errAgentWorkflowTransactionRetry
		}
		commandEvent, err := newCommandResultEvent(
			tx,
			workflow.ProjectID,
			workflow.ID,
			"workflow-envelope:"+strings.TrimSpace(input.CommandID),
			"agent.workflow.envelope_created",
			input.CommandFingerprint,
			fmt.Sprintf(`{"workflowId":%q,"rootTaskId":%q,"invocationId":%q,"runId":%q}`, workflow.ID, rootTask.ID, rootInvocation.ID, rootInvocation.RunID),
			workflow.Revision,
			workflow.CreatedAt,
		)
		if err != nil {
			return err
		}
		if err := tx.Create(&commandEvent).Error; err != nil {
			return fmt.Errorf("recording workflow envelope command: %w", err)
		}
		output = AgentWorkflowEnvelopeResult{
			Applied: true, WorkflowID: workflow.ID, RootTaskID: rootTask.ID,
			InvocationID: rootInvocation.ID, RunID: rootInvocation.RunID,
		}
		return nil
	})
	if err != nil {
		return AgentWorkflowEnvelopeResult{}, err
	}
	return output, nil
}

func findWorkflowEnvelopeReplayTx(tx *gorm.DB, input AgentWorkflowEnvelopeInput) (AgentWorkflowEnvelopeResult, bool, error) {
	var event domain.AgentWorkflowEventModel
	err := tx.Table("agent_workflow_events AS events").
		Select("events.*").
		Joins("JOIN agent_workflows AS workflows ON workflows.project_id = events.project_id AND workflows.id = events.workflow_id").
		Where(
			"events.project_id = ? AND workflows.session_id = ? AND events.idempotency_key = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.SessionID), "workflow-envelope:"+strings.TrimSpace(input.CommandID),
		).
		First(&event).Error
	if IsRecordNotFound(err) {
		return AgentWorkflowEnvelopeResult{}, false, nil
	}
	if err != nil {
		return AgentWorkflowEnvelopeResult{}, false, fmt.Errorf("reading workflow envelope replay: %w", err)
	}
	if event.PayloadFingerprint != strings.TrimSpace(input.CommandFingerprint) {
		return AgentWorkflowEnvelopeResult{}, false, ErrAgentCommandConflict
	}
	var persisted struct {
		WorkflowID   string `json:"workflowId"`
		RootTaskID   string `json:"rootTaskId"`
		InvocationID string `json:"invocationId"`
		RunID        string `json:"runId"`
	}
	if err := json.Unmarshal([]byte(event.PayloadJSON), &persisted); err != nil {
		return AgentWorkflowEnvelopeResult{}, false, fmt.Errorf("decoding workflow envelope replay: %w", err)
	}
	if persisted.WorkflowID != input.Workflow.ID || persisted.RootTaskID != input.RootTask.ID || persisted.InvocationID != input.RootInvocation.ID || persisted.RunID != input.RootInvocation.RunID {
		return AgentWorkflowEnvelopeResult{}, false, ErrAgentCommandConflict
	}
	return AgentWorkflowEnvelopeResult{
		Applied: false, WorkflowID: persisted.WorkflowID, RootTaskID: persisted.RootTaskID,
		InvocationID: persisted.InvocationID, RunID: persisted.RunID,
	}, true, nil
}

func validateWorkflowEnvelope(input AgentWorkflowEnvelopeInput) error {
	projectID := strings.TrimSpace(input.ProjectID)
	sessionID := strings.TrimSpace(input.SessionID)
	if projectID == "" || sessionID == "" || strings.TrimSpace(input.CommandID) == "" || strings.TrimSpace(input.CommandFingerprint) == "" {
		return ErrAgentInvalidCAS
	}
	if input.Workflow.ProjectID != projectID || input.Workflow.SessionID != sessionID || input.Workflow.ID == "" || input.Workflow.RootTaskID == "" {
		return ErrAgentInvalidCAS
	}
	if input.RootTask.ProjectID != projectID || input.RootTask.WorkflowID != input.Workflow.ID || input.RootTask.ID != input.Workflow.RootTaskID || input.RootTask.Role != "root" {
		return ErrAgentInvalidCAS
	}
	if input.RootInvocation.ProjectID != projectID || input.RootInvocation.WorkflowID != input.Workflow.ID || input.RootInvocation.TaskID != input.RootTask.ID || input.RootInvocation.ID == "" || input.RootInvocation.RunID == "" {
		return ErrAgentInvalidCAS
	}
	return nil
}

func loadActiveEnvelopeResultTx(tx *gorm.DB, projectID string, workflowID string, output *AgentWorkflowEnvelopeResult) error {
	var workflow domain.AgentWorkflowModel
	if err := tx.First(&workflow, "project_id = ? AND id = ?", projectID, workflowID).Error; err != nil {
		return fmt.Errorf("reading active workflow envelope: %w", err)
	}
	var task domain.AgentTaskModel
	if err := tx.First(&task, "project_id = ? AND id = ?", projectID, workflow.RootTaskID).Error; err != nil {
		return fmt.Errorf("reading active workflow root task: %w", err)
	}
	invocationID := domain.StringValue(task.CurrentInvocationID)
	var invocation domain.AgentInvocationModel
	if invocationID != "" {
		if err := tx.First(&invocation, "project_id = ? AND id = ?", projectID, invocationID).Error; err != nil {
			return fmt.Errorf("reading active workflow root invocation: %w", err)
		}
	}
	*output = AgentWorkflowEnvelopeResult{
		Applied: false, WorkflowID: workflow.ID, RootTaskID: task.ID,
		InvocationID: invocation.ID, RunID: invocation.RunID,
	}
	return nil
}

// ReplaceWorkflow atomically terminates the predecessor scope, creates one
// deterministic successor envelope and handoff, installs the final-delivery
// barrier, and cleans pending predecessor work.
func (uow *AgentWorkflowUnitOfWork) ReplaceWorkflow(
	ctx context.Context,
	input AgentWorkflowReplaceInput,
) (AgentWorkflowReplaceResult, error) {
	if err := validateWorkflowReplace(input); err != nil {
		return AgentWorkflowReplaceResult{}, err
	}
	var output AgentWorkflowReplaceResult
	err := runAgentWorkflowTransaction(ctx, uow.db, func(tx *gorm.DB) error {
		var existing domain.AgentWorkflowHandoffModel
		err := tx.Where(
			"project_id = ? AND session_id = ? AND predecessor_workflow_id = ? AND replace_command_id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.SessionID), strings.TrimSpace(input.PredecessorWorkflowID), strings.TrimSpace(input.CommandID),
		).First(&existing).Error
		if err == nil {
			if existing.ReplaceCommandFingerprint != strings.TrimSpace(input.CommandFingerprint) ||
				existing.SuccessorWorkflowID != input.SuccessorWorkflow.ID ||
				existing.SuccessorRootTaskID != input.SuccessorRootTask.ID ||
				existing.SuccessorInvocationID != input.SuccessorRootInvocation.ID ||
				existing.SuccessorRunID != input.SuccessorRootInvocation.RunID ||
				existing.PredecessorFinalDeliveryID != input.PredecessorFinalDelivery.ID {
				return ErrAgentCommandConflict
			}
			output = replaceResultFromHandoff(existing, false)
			return nil
		}
		if !IsRecordNotFound(err) {
			return fmt.Errorf("checking workflow replace command: %w", err)
		}

		var predecessor domain.AgentWorkflowModel
		if err := tx.First(&predecessor,
			"project_id = ? AND id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.PredecessorWorkflowID),
		).Error; err != nil {
			if IsRecordNotFound(err) {
				return ErrAgentStaleRevision
			}
			return fmt.Errorf("reading predecessor workflow: %w", err)
		}
		if predecessor.Status != "active" || predecessor.Revision != input.ExpectedPredecessorRevision {
			return ErrAgentStaleRevision
		}
		var session domain.AgentSessionModel
		if err := tx.First(&session,
			"project_id = ? AND session_id = ?",
			input.ProjectID, input.SessionID,
		).Error; err != nil {
			return fmt.Errorf("reading replace session: %w", err)
		}
		if domain.StringValue(session.ActiveWorkflowID) != predecessor.ID || session.PendingFinalDeliveryID != nil {
			return ErrAgentStaleRevision
		}

		completedAt := input.CompletedAt.UTC()
		workflowResult := tx.Model(&domain.AgentWorkflowModel{}).
			Where("project_id = ? AND id = ? AND status = ? AND revision = ?", predecessor.ProjectID, predecessor.ID, "active", input.ExpectedPredecessorRevision).
			Updates(map[string]any{
				"status": "cancelled", "revision": input.ExpectedPredecessorRevision + 1,
				"updated_at": completedAt, "completed_at": completedAt,
			})
		if workflowResult.Error != nil {
			return fmt.Errorf("terminating predecessor workflow: %w", workflowResult.Error)
		}
		if workflowResult.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		if err := cancelNonterminalWorkflowTasksTx(tx, predecessor.ProjectID, predecessor.ID, "workflow_replaced", completedAt); err != nil {
			return err
		}
		if _, err := supersedePendingAgentSelectionsByWorkflow(tx, predecessor.ProjectID, predecessor.ID, "workflow_replaced", fmt.Sprint(predecessor.GoalVersion), completedAt); err != nil {
			return err
		}
		if err := discardWorkflowContinuationsTx(tx, predecessor.ProjectID, predecessor.ID, "workflow_replaced", completedAt); err != nil {
			return err
		}

		successor := input.SuccessorWorkflow
		rootTask := input.SuccessorRootTask
		rootInvocation := input.SuccessorRootInvocation
		if rootTask.CurrentInvocationID == nil {
			rootTask.CurrentInvocationID = domain.StringPtr(rootInvocation.ID)
		}
		for _, write := range []struct {
			name  string
			value any
		}{
			{name: "successor workflow", value: &successor},
			{name: "successor root task", value: &rootTask},
			{name: "successor root invocation", value: &rootInvocation},
			{name: "predecessor root final delivery", value: &input.PredecessorFinalDelivery},
			{name: "workflow handoff", value: &input.Handoff},
		} {
			if err := tx.Create(write.value).Error; err != nil {
				return fmt.Errorf("creating %s: %w", write.name, err)
			}
		}
		sessionResult := tx.Model(&domain.AgentSessionModel{}).
			Where(
				"project_id = ? AND session_id = ? AND revision = ? AND active_workflow_id = ? AND pending_final_delivery_id IS NULL",
				session.ProjectID, session.SessionID, session.Revision, predecessor.ID,
			).
			Updates(map[string]any{
				"active_workflow_id":        successor.ID,
				"pending_final_delivery_id": input.PredecessorFinalDelivery.ID,
				"revision":                  session.Revision + 1,
			})
		if sessionResult.Error != nil {
			return fmt.Errorf("switching session to successor workflow: %w", sessionResult.Error)
		}
		if sessionResult.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		output = replaceResultFromHandoff(input.Handoff, true)
		return nil
	})
	if err != nil {
		return AgentWorkflowReplaceResult{}, err
	}
	return output, nil
}

func validateWorkflowReplace(input AgentWorkflowReplaceInput) error {
	projectID := strings.TrimSpace(input.ProjectID)
	sessionID := strings.TrimSpace(input.SessionID)
	predecessorID := strings.TrimSpace(input.PredecessorWorkflowID)
	if projectID == "" || sessionID == "" || predecessorID == "" || input.ExpectedPredecessorRevision == 0 || strings.TrimSpace(input.CommandID) == "" || strings.TrimSpace(input.CommandFingerprint) == "" {
		return ErrAgentInvalidCAS
	}
	if input.SuccessorWorkflow.ProjectID != projectID || input.SuccessorWorkflow.SessionID != sessionID || input.SuccessorWorkflow.ID == "" || input.SuccessorWorkflow.GoalVersion != 1 || strings.TrimSpace(input.SuccessorWorkflow.GoalJSON) == "" {
		return ErrAgentInvalidCAS
	}
	if input.SuccessorRootTask.ProjectID != projectID || input.SuccessorRootTask.WorkflowID != input.SuccessorWorkflow.ID || input.SuccessorRootTask.ID != input.SuccessorWorkflow.RootTaskID || input.SuccessorRootTask.Role != "root" {
		return ErrAgentInvalidCAS
	}
	if input.SuccessorRootInvocation.ProjectID != projectID || input.SuccessorRootInvocation.WorkflowID != input.SuccessorWorkflow.ID || input.SuccessorRootInvocation.TaskID != input.SuccessorRootTask.ID || input.SuccessorRootInvocation.RunID == "" {
		return ErrAgentInvalidCAS
	}
	if input.PredecessorFinalDelivery.ProjectID != projectID || input.PredecessorFinalDelivery.SessionID != sessionID || input.PredecessorFinalDelivery.WorkflowID != predecessorID || input.PredecessorFinalDelivery.ID == "" {
		return ErrAgentInvalidCAS
	}
	if input.Handoff.ProjectID != projectID || input.Handoff.SessionID != sessionID || input.Handoff.PredecessorWorkflowID != predecessorID || input.Handoff.SuccessorWorkflowID != input.SuccessorWorkflow.ID || input.Handoff.ReplaceCommandID != input.CommandID || input.Handoff.ReplaceCommandFingerprint != input.CommandFingerprint || input.Handoff.PredecessorFinalDeliveryID != input.PredecessorFinalDelivery.ID || input.Handoff.SuccessorRootTaskID != input.SuccessorRootTask.ID || input.Handoff.SuccessorInvocationID != input.SuccessorRootInvocation.ID || input.Handoff.SuccessorRunID != input.SuccessorRootInvocation.RunID {
		return ErrAgentInvalidCAS
	}
	return nil
}

func replaceResultFromHandoff(handoff domain.AgentWorkflowHandoffModel, applied bool) AgentWorkflowReplaceResult {
	return AgentWorkflowReplaceResult{
		Applied:                    applied,
		SuccessorWorkflowID:        handoff.SuccessorWorkflowID,
		SuccessorRootTaskID:        handoff.SuccessorRootTaskID,
		SuccessorRootInvocationID:  handoff.SuccessorInvocationID,
		SuccessorRunID:             handoff.SuccessorRunID,
		HandoffID:                  handoff.ID,
		PredecessorFinalDeliveryID: handoff.PredecessorFinalDeliveryID,
	}
}

// TerminateWorkflow atomically marks a Workflow terminal, cancels every
// remaining logical Task, supersedes pending selections, discards unacked
// continuations, and clears the matching active session pointer.
func (uow *AgentWorkflowUnitOfWork) TerminateWorkflow(
	ctx context.Context,
	input AgentWorkflowTerminateInput,
) (AgentWorkflowTerminateResult, error) {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.SessionID) == "" || strings.TrimSpace(input.WorkflowID) == "" || input.ExpectedRevision == 0 || strings.TrimSpace(input.CommandID) == "" || strings.TrimSpace(input.CommandFingerprint) == "" || !isWorkflowTerminalStatus(input.TerminalStatus) || strings.TrimSpace(input.Reason) == "" || input.CompletedAt.IsZero() {
		return AgentWorkflowTerminateResult{}, ErrAgentInvalidCAS
	}
	var output AgentWorkflowTerminateResult
	err := runAgentWorkflowTransaction(ctx, uow.db, func(tx *gorm.DB) error {
		var scopedWorkflow domain.AgentWorkflowModel
		if err := tx.First(&scopedWorkflow,
			"project_id = ? AND id = ? AND session_id = ?",
			strings.TrimSpace(input.ProjectID), strings.TrimSpace(input.WorkflowID), strings.TrimSpace(input.SessionID),
		).Error; err != nil {
			if IsRecordNotFound(err) {
				return ErrAgentStaleRevision
			}
			return fmt.Errorf("reading scoped workflow for termination: %w", err)
		}
		idempotencyKey := "workflow-terminate:" + strings.TrimSpace(input.CommandID)
		if replay, found, err := findCommandResultTx(tx, input.ProjectID, input.WorkflowID, idempotencyKey, input.CommandFingerprint); err != nil {
			return err
		} else if found {
			output = AgentWorkflowTerminateResult{Applied: false, WorkflowID: input.WorkflowID, Revision: replay.Revision}
			return nil
		}
		var session domain.AgentSessionModel
		if err := tx.First(&session, "project_id = ? AND session_id = ?", input.ProjectID, input.SessionID).Error; err != nil {
			return fmt.Errorf("reading session for workflow termination: %w", err)
		}
		if domain.StringValue(session.ActiveWorkflowID) != strings.TrimSpace(input.WorkflowID) {
			return ErrAgentStaleRevision
		}
		completedAt := input.CompletedAt.UTC()
		nextRevision := input.ExpectedRevision + 1
		result := tx.Model(&domain.AgentWorkflowModel{}).
			Where("project_id = ? AND id = ? AND status = ? AND revision = ?", input.ProjectID, input.WorkflowID, "active", input.ExpectedRevision).
			Updates(map[string]any{
				"status": input.TerminalStatus, "revision": nextRevision,
				"updated_at": completedAt, "completed_at": completedAt,
			})
		if result.Error != nil {
			return fmt.Errorf("terminating workflow: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		if err := cancelNonterminalWorkflowTasksTx(tx, input.ProjectID, input.WorkflowID, input.Reason, completedAt); err != nil {
			return err
		}
		if _, err := supersedePendingAgentSelectionsByWorkflow(tx, input.ProjectID, input.WorkflowID, input.Reason, "", completedAt); err != nil {
			return err
		}
		if err := discardWorkflowContinuationsTx(tx, input.ProjectID, input.WorkflowID, input.Reason, completedAt); err != nil {
			return err
		}
		sessionResult := tx.Model(&domain.AgentSessionModel{}).
			Where("project_id = ? AND session_id = ? AND revision = ? AND active_workflow_id = ?", input.ProjectID, input.SessionID, session.Revision, input.WorkflowID).
			Updates(map[string]any{"active_workflow_id": nil, "revision": session.Revision + 1})
		if sessionResult.Error != nil {
			return fmt.Errorf("clearing terminal workflow session pointer: %w", sessionResult.Error)
		}
		if sessionResult.RowsAffected != 1 {
			return ErrAgentStaleRevision
		}
		commandEvent, err := newCommandResultEvent(
			tx, input.ProjectID, input.WorkflowID, idempotencyKey, "agent.workflow.terminated",
			input.CommandFingerprint,
			fmt.Sprintf(`{"workflowId":%q,"revision":%d}`, input.WorkflowID, nextRevision),
			nextRevision, completedAt,
		)
		if err != nil {
			return err
		}
		if err := tx.Create(&commandEvent).Error; err != nil {
			return fmt.Errorf("recording workflow termination command: %w", err)
		}
		output = AgentWorkflowTerminateResult{Applied: true, WorkflowID: input.WorkflowID, Revision: nextRevision}
		return nil
	})
	if err != nil {
		return AgentWorkflowTerminateResult{}, err
	}
	return output, nil
}

func isWorkflowTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "cancelled":
		return true
	default:
		return false
	}
}

func cancelNonterminalWorkflowTasksTx(tx *gorm.DB, projectID string, workflowID string, reason string, completedAt time.Time) error {
	result := tx.Model(&domain.AgentTaskModel{}).
		Where("project_id = ? AND workflow_id = ? AND status NOT IN ?", projectID, workflowID, []string{"completed", "failed", "cancelled"}).
		Updates(map[string]any{
			"status": "cancelled", "revision": gorm.Expr("revision + 1"),
			"current_invocation_id": nil, "last_error_code": strings.TrimSpace(reason),
			"updated_at": completedAt.UTC(), "completed_at": completedAt.UTC(),
		})
	if result.Error != nil {
		return fmt.Errorf("bulk-cancelling workflow tasks: %w", result.Error)
	}
	return nil
}

func discardWorkflowContinuationsTx(tx *gorm.DB, projectID string, workflowID string, reason string, discardedAt time.Time) error {
	result := tx.Model(&domain.AgentWorkflowEventModel{}).
		Where("project_id = ? AND workflow_id = ? AND delivery_id IS NOT NULL", projectID, workflowID).
		Where("delivery_status NOT IN ?", []string{"acked", "discarded"}).
		Updates(map[string]any{
			"delivery_status": "discarded", "discard_reason": strings.TrimSpace(reason), "discarded_at": discardedAt.UTC(),
			"lease_owner": nil, "lease_until": nil, "lease_token": gorm.Expr("lease_token + 1"),
		})
	if result.Error != nil {
		return fmt.Errorf("discarding workflow continuations: %w", result.Error)
	}
	return nil
}

var errAgentWorkflowTransactionRetry = errors.New("retry agent workflow transaction")

func runAgentWorkflowTransaction(ctx context.Context, db *gorm.DB, fn func(*gorm.DB) error) error {
	const attempts = 20
	for attempt := 0; attempt < attempts; attempt++ {
		err := db.WithContext(ctx).Transaction(fn)
		if err == nil {
			return nil
		}
		if !errors.Is(err, errAgentWorkflowTransactionRetry) && !isSQLiteBusyError(err) {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
	}
	return fmt.Errorf("agent workflow transaction retries exhausted: %w", ErrAgentStaleRevision)
}

func isSQLiteBusyError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") || strings.Contains(message, "database table is locked") || strings.Contains(message, "sqlite_busy")
}
