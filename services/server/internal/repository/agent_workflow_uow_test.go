package repository

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestAgentExecutionWorkflowEnvelopeCASAllowsOneActiveWorkflow(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-envelope-cas"
	sessionID := "session-envelope-cas"
	seedRepositoryProject(t, db, projectID)
	if err := NewAgentSessionRepository(db).UpsertAgentSession(domain.AgentSessionModel{SessionID: sessionID, ProjectID: projectID}); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}
	uow := NewAgentWorkflowUnitOfWork(db)
	now := domain.TimeFromString("2026-07-17T01:00:00Z")
	const callers = 20
	start := make(chan struct{})
	results := make(chan AgentWorkflowEnvelopeResult, callers)
	errs := make(chan error, callers)
	var group sync.WaitGroup
	for index := 0; index < callers; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			<-start
			workflowID := fmt.Sprintf("workflow-%02d", index)
			taskID := fmt.Sprintf("task-%02d", index)
			invocationID := fmt.Sprintf("invocation-%02d", index)
			result, err := uow.CreateWorkflowEnvelope(context.Background(), AgentWorkflowEnvelopeInput{
				ProjectID:          projectID,
				SessionID:          sessionID,
				CommandID:          fmt.Sprintf("command-%02d", index),
				CommandFingerprint: fmt.Sprintf("fingerprint-%02d", index),
				Workflow:           domain.AgentWorkflowModel{ProjectID: projectID, ID: workflowID, SessionID: sessionID, RootTaskID: taskID, Status: "active", Revision: 1, CreatedAt: now, UpdatedAt: now},
				RootTask:           domain.AgentTaskModel{ProjectID: projectID, ID: taskID, WorkflowID: workflowID, Role: "root", Status: "pending", Revision: 1, CreatedAt: now, UpdatedAt: now},
				RootInvocation:     domain.AgentInvocationModel{ProjectID: projectID, ID: invocationID, WorkflowID: workflowID, TaskID: taskID, RunID: "run-" + invocationID, Status: "pending", Revision: 1, RootFinalChallengeStatus: domain.StringPtr("pending"), CreatedAt: now, UpdatedAt: now},
			})
			results <- result
			errs <- err
		}(index)
	}
	close(start)
	group.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("CreateWorkflowEnvelope() error = %v", err)
		}
	}
	applied := 0
	activeID := ""
	for result := range results {
		if result.Applied {
			applied++
		}
		if activeID == "" {
			activeID = result.WorkflowID
		} else if result.WorkflowID != activeID {
			t.Fatalf("result WorkflowID = %q, want shared active %q", result.WorkflowID, activeID)
		}
	}
	if applied != 1 {
		t.Fatalf("applied envelope count = %d, want 1", applied)
	}
	session, err := NewAgentSessionRepository(db).GetAgentSession(sessionID)
	if err != nil || domain.StringValue(session.ActiveWorkflowID) != activeID {
		t.Fatalf("active session = %#v, error=%v", session, err)
	}
	var workflowCount, taskCount, invocationCount int64
	if err := db.Model(&domain.AgentWorkflowModel{}).Count(&workflowCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&domain.AgentTaskModel{}).Count(&taskCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&domain.AgentInvocationModel{}).Count(&invocationCount).Error; err != nil {
		t.Fatal(err)
	}
	if workflowCount != 1 || taskCount != 1 || invocationCount != 1 {
		t.Fatalf("envelope counts = workflow:%d task:%d invocation:%d, want 1 each", workflowCount, taskCount, invocationCount)
	}
}

func TestAgentExecutionWorkflowEnvelopeReplayReturnsFirstResultAfterTermination(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-envelope-replay"
	sessionID := "session-envelope-replay"
	seedRepositoryProject(t, db, projectID)
	if err := NewAgentSessionRepository(db).UpsertAgentSession(domain.AgentSessionModel{SessionID: sessionID, ProjectID: projectID}); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}
	now := domain.TimeFromString("2026-07-17T01:30:00Z")
	input := AgentWorkflowEnvelopeInput{
		ProjectID: projectID, SessionID: sessionID, CommandID: "envelope-replay-command", CommandFingerprint: "envelope-replay-fingerprint",
		Workflow:       domain.AgentWorkflowModel{ProjectID: projectID, ID: "workflow-envelope-replay", SessionID: sessionID, RootTaskID: "task-envelope-replay", Status: "active", Revision: 1, CreatedAt: now, UpdatedAt: now},
		RootTask:       domain.AgentTaskModel{ProjectID: projectID, ID: "task-envelope-replay", WorkflowID: "workflow-envelope-replay", Role: "root", Status: "pending", Revision: 1, CreatedAt: now, UpdatedAt: now},
		RootInvocation: domain.AgentInvocationModel{ProjectID: projectID, ID: "invocation-envelope-replay", WorkflowID: "workflow-envelope-replay", TaskID: "task-envelope-replay", RunID: "run-envelope-replay", Status: "pending", Revision: 1, CreatedAt: now, UpdatedAt: now},
	}
	uow := NewAgentWorkflowUnitOfWork(db)
	first, err := uow.CreateWorkflowEnvelope(context.Background(), input)
	if err != nil || !first.Applied {
		t.Fatalf("CreateWorkflowEnvelope() = %#v, error=%v", first, err)
	}
	if _, err := uow.TerminateWorkflow(context.Background(), AgentWorkflowTerminateInput{
		ProjectID: projectID, SessionID: sessionID, WorkflowID: input.Workflow.ID, ExpectedRevision: 1,
		CommandID: "terminate-envelope-replay", CommandFingerprint: "terminate-envelope-replay",
		TerminalStatus: "cancelled", Reason: "user_cancelled", CompletedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("TerminateWorkflow() error = %v", err)
	}
	replay, err := uow.CreateWorkflowEnvelope(context.Background(), input)
	if err != nil || replay.Applied || replay.WorkflowID != first.WorkflowID || replay.RootTaskID != first.RootTaskID || replay.InvocationID != first.InvocationID || replay.RunID != first.RunID {
		t.Fatalf("replayed CreateWorkflowEnvelope() = %#v, error=%v, want first %#v", replay, err, first)
	}
}

func TestAgentExecutionWorkflowReplaceIsAtomicAndIdempotent(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-replace"
	sessionID := "session-replace"
	seedRepositoryProject(t, db, projectID)
	oldWorkflowID := "workflow-old"
	active := oldWorkflowID
	if err := NewAgentSessionRepository(db).UpsertAgentSession(domain.AgentSessionModel{SessionID: sessionID, ProjectID: projectID, ActiveWorkflowID: &active, Revision: 1}); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}
	now := domain.TimeFromString("2026-07-17T02:00:00Z")
	for _, model := range []any{
		&domain.AgentWorkflowModel{ProjectID: projectID, ID: oldWorkflowID, SessionID: sessionID, RootTaskID: "task-old", Status: "active", GoalVersion: 2, Revision: 3, CreatedAt: now, UpdatedAt: now},
		&domain.AgentTaskModel{ProjectID: projectID, ID: "task-old", WorkflowID: oldWorkflowID, Role: "root", Status: "running", Revision: 2, CreatedAt: now, UpdatedAt: now},
		&domain.AgentInvocationModel{ProjectID: projectID, ID: "invocation-old", WorkflowID: oldWorkflowID, TaskID: "task-old", RunID: "run-old", Status: "running", Revision: 2, RootFinalChallengeStatus: domain.StringPtr("pending"), CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(model).Error; err != nil {
			t.Fatalf("creating old workflow fixture %T: %v", model, err)
		}
	}
	selectionRepo := NewAgentSelectionRepository(db)
	if err := selectionRepo.CreateAgentSelection(domain.AgentSelectionModel{ProjectID: projectID, ID: "selection-old", SessionID: sessionID, WorkflowID: oldWorkflowID, Kind: "confirmation", Status: "pending", CreatedAt: now}); err != nil {
		t.Fatalf("creating pending selection: %v", err)
	}
	deliveryStatus := "pending"
	deliveryID := "continuation-old"
	resume := "resume-old"
	if err := db.Create(&domain.AgentWorkflowEventModel{ProjectID: projectID, ID: "event-old", WorkflowID: oldWorkflowID, Sequence: 1, EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "old", IdempotencyKey: "old", DeliveryID: &deliveryID, ResumeToken: &resume, DeliveryStatus: &deliveryStatus}).Error; err != nil {
		t.Fatalf("creating continuation: %v", err)
	}
	if err := db.Create(&domain.AgentWorkflowEventModel{
		ProjectID: projectID, ID: "event-old-envelope", WorkflowID: oldWorkflowID, Sequence: 2,
		EventType: "agent.workflow.envelope_created", EventVersion: 1,
		PayloadJSON:        `{"workflowId":"workflow-old","rootTaskId":"task-old","invocationId":"invocation-old","runId":"run-old"}`,
		PayloadFingerprint: "old-envelope-fingerprint", IdempotencyKey: "workflow-envelope:old-envelope-command",
	}).Error; err != nil {
		t.Fatalf("creating old envelope command: %v", err)
	}
	newWorkflowID := "workflow-new"
	newTaskID := "task-new"
	newInvocationID := "invocation-new"
	finalDeliveryID := "final-old"
	input := AgentWorkflowReplaceInput{
		ProjectID: projectID, SessionID: sessionID, PredecessorWorkflowID: oldWorkflowID,
		ExpectedPredecessorRevision: 3, CommandID: "replace-command", CommandFingerprint: "replace-fingerprint", CompletedAt: now.Add(time.Minute),
		SuccessorWorkflow:        domain.AgentWorkflowModel{ProjectID: projectID, ID: newWorkflowID, SessionID: sessionID, RootTaskID: newTaskID, Status: "active", GoalJSON: `{"version":1,"objective":"new"}`, GoalVersion: 1, Revision: 1, CreatedAt: now, UpdatedAt: now},
		SuccessorRootTask:        domain.AgentTaskModel{ProjectID: projectID, ID: newTaskID, WorkflowID: newWorkflowID, Role: "root", Status: "pending", Revision: 1, CreatedAt: now, UpdatedAt: now},
		SuccessorRootInvocation:  domain.AgentInvocationModel{ProjectID: projectID, ID: newInvocationID, WorkflowID: newWorkflowID, TaskID: newTaskID, RunID: "run-new", Status: "pending", Revision: 1, RootFinalChallengeStatus: domain.StringPtr("pending"), CreatedAt: now, UpdatedAt: now},
		PredecessorFinalDelivery: domain.AgentRootFinalDeliveryModel{ProjectID: projectID, ID: finalDeliveryID, SessionID: sessionID, WorkflowID: oldWorkflowID, RootTaskID: "task-old", RootInvocationID: "invocation-old", RootRunID: "run-old", MessageEventID: "message-old", RunCompletedEventID: "completed-old", EventBundleJSON: `[]`, BundleFingerprint: "bundle-old", Phase: "pending", Revision: 1, CreatedAt: now},
		Handoff:                  domain.AgentWorkflowHandoffModel{ProjectID: projectID, ID: "handoff-old-new", SessionID: sessionID, PredecessorWorkflowID: oldWorkflowID, SuccessorWorkflowID: newWorkflowID, ReplaceCommandID: "replace-command", ReplaceCommandFingerprint: "replace-fingerprint", PredecessorFinalDeliveryID: finalDeliveryID, SuccessorRootTaskID: newTaskID, SuccessorInvocationID: newInvocationID, SuccessorRunID: "run-new", Status: "pending", Revision: 1, CreatedAt: now},
	}
	uow := NewAgentWorkflowUnitOfWork(db)
	first, err := uow.ReplaceWorkflow(context.Background(), input)
	if err != nil || !first.Applied || first.SuccessorWorkflowID != newWorkflowID {
		t.Fatalf("ReplaceWorkflow() = %#v, error=%v", first, err)
	}
	second, err := uow.ReplaceWorkflow(context.Background(), input)
	if err != nil || second.Applied || second.SuccessorWorkflowID != newWorkflowID {
		t.Fatalf("replayed ReplaceWorkflow() = %#v, error=%v", second, err)
	}
	wrongSessionReplace := input
	wrongSessionReplace.SessionID = "session-other"
	wrongSessionReplace.SuccessorWorkflow.SessionID = "session-other"
	wrongSessionReplace.PredecessorFinalDelivery.SessionID = "session-other"
	wrongSessionReplace.Handoff.SessionID = "session-other"
	if _, err := uow.ReplaceWorkflow(context.Background(), wrongSessionReplace); !errors.Is(err, ErrAgentStaleRevision) {
		t.Fatalf("wrong-session ReplaceWorkflow replay error = %v, want ErrAgentStaleRevision", err)
	}
	session, err := NewAgentSessionRepository(db).GetAgentSession(sessionID)
	if err != nil || domain.StringValue(session.ActiveWorkflowID) != newWorkflowID || domain.StringValue(session.PendingFinalDeliveryID) != finalDeliveryID {
		t.Fatalf("session after replace = %#v, error=%v", session, err)
	}
	oldTask, err := NewAgentExecutionRepository(db).GetTask(context.Background(), projectID, "task-old")
	if err != nil || oldTask.Status != "cancelled" || oldTask.LastErrorCode != "workflow_replaced" {
		t.Fatalf("old task after replace = %#v, error=%v", oldTask, err)
	}
	selection, err := selectionRepo.GetAgentSelection(projectID, "selection-old")
	if err != nil || selection.Status != "superseded" || selection.SupersededReason != "workflow_replaced" {
		t.Fatalf("selection after replace = %#v, error=%v", selection, err)
	}
	event, err := NewAgentExecutionRepository(db).GetWorkflowEvent(context.Background(), projectID, "event-old")
	if err != nil || domain.StringValue(event.DeliveryStatus) != "discarded" {
		t.Fatalf("continuation after replace = %#v, error=%v", event, err)
	}
	oldEnvelope, err := uow.CreateWorkflowEnvelope(context.Background(), AgentWorkflowEnvelopeInput{
		ProjectID: projectID, SessionID: sessionID, CommandID: "old-envelope-command", CommandFingerprint: "old-envelope-fingerprint",
		Workflow:       domain.AgentWorkflowModel{ProjectID: projectID, ID: oldWorkflowID, SessionID: sessionID, RootTaskID: "task-old"},
		RootTask:       domain.AgentTaskModel{ProjectID: projectID, ID: "task-old", WorkflowID: oldWorkflowID, Role: "root"},
		RootInvocation: domain.AgentInvocationModel{ProjectID: projectID, ID: "invocation-old", WorkflowID: oldWorkflowID, TaskID: "task-old", RunID: "run-old"},
	})
	if err != nil || oldEnvelope.Applied || oldEnvelope.WorkflowID != oldWorkflowID || oldEnvelope.InvocationID != "invocation-old" {
		t.Fatalf("old envelope replay after replace = %#v, error=%v", oldEnvelope, err)
	}
}

func TestAgentExecutionWorkflowTerminateIsAtomicAndIdempotent(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-terminate"
	sessionID := "session-terminate"
	workflowID := "workflow-terminate"
	active := workflowID
	seedRepositoryProject(t, db, projectID)
	if err := NewAgentSessionRepository(db).UpsertAgentSession(domain.AgentSessionModel{
		SessionID: sessionID, ProjectID: projectID, ActiveWorkflowID: &active, Revision: 4,
	}); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}
	now := domain.TimeFromString("2026-07-17T02:30:00Z")
	for _, model := range []any{
		&domain.AgentWorkflowModel{ProjectID: projectID, ID: workflowID, SessionID: sessionID, RootTaskID: "task-terminate", Status: "active", Revision: 6, CreatedAt: now, UpdatedAt: now},
		&domain.AgentTaskModel{ProjectID: projectID, ID: "task-terminate", WorkflowID: workflowID, Role: "root", Status: "running", Revision: 3, CreatedAt: now, UpdatedAt: now},
		&domain.AgentTaskModel{ProjectID: projectID, ID: "task-terminal", WorkflowID: workflowID, Role: "child", Status: "completed", Revision: 2, CreatedAt: now, UpdatedAt: now, CompletedAt: &now},
	} {
		if err := db.Create(model).Error; err != nil {
			t.Fatalf("creating termination fixture %T: %v", model, err)
		}
	}
	selectionRepo := NewAgentSelectionRepository(db)
	if err := selectionRepo.CreateAgentSelection(domain.AgentSelectionModel{
		ProjectID: projectID, ID: "selection-terminate", SessionID: sessionID, WorkflowID: workflowID,
		Kind: "confirmation", Status: "pending", CreatedAt: now,
	}); err != nil {
		t.Fatalf("creating termination selection: %v", err)
	}
	deliveryID := "delivery-terminate"
	resumeToken := "resume-terminate"
	deliveryStatus := "delivered"
	if err := db.Create(&domain.AgentWorkflowEventModel{
		ProjectID: projectID, ID: "event-terminate", WorkflowID: workflowID, Sequence: 1,
		EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "terminate-event", IdempotencyKey: "terminate-event",
		DeliveryID: &deliveryID, ResumeToken: &resumeToken, DeliveryStatus: &deliveryStatus,
	}).Error; err != nil {
		t.Fatalf("creating termination continuation: %v", err)
	}
	input := AgentWorkflowTerminateInput{
		ProjectID: projectID, SessionID: sessionID, WorkflowID: workflowID, ExpectedRevision: 6,
		CommandID: "terminate-command", CommandFingerprint: "terminate-fingerprint",
		TerminalStatus: "failed", Reason: "root_failed", CompletedAt: now.Add(time.Minute),
	}
	uow := NewAgentWorkflowUnitOfWork(db)
	first, err := uow.TerminateWorkflow(context.Background(), input)
	if err != nil || !first.Applied || first.Revision != 7 {
		t.Fatalf("TerminateWorkflow() = %#v, error=%v", first, err)
	}
	replay, err := uow.TerminateWorkflow(context.Background(), input)
	if err != nil || replay.Applied || replay.Revision != 7 {
		t.Fatalf("replayed TerminateWorkflow() = %#v, error=%v", replay, err)
	}
	wrongSession := input
	wrongSession.SessionID = "session-other"
	if _, err := uow.TerminateWorkflow(context.Background(), wrongSession); !errors.Is(err, ErrAgentStaleRevision) {
		t.Fatalf("wrong-session TerminateWorkflow replay error = %v, want ErrAgentStaleRevision", err)
	}
	conflict := input
	conflict.CommandFingerprint = "different"
	if _, err := uow.TerminateWorkflow(context.Background(), conflict); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("conflicting TerminateWorkflow() error = %v, want ErrAgentCommandConflict", err)
	}
	workflow, err := NewAgentExecutionRepository(db).GetWorkflow(context.Background(), projectID, workflowID)
	if err != nil || workflow.Status != "failed" || workflow.Revision != 7 || workflow.CompletedAt == nil {
		t.Fatalf("terminated workflow = %#v, error=%v", workflow, err)
	}
	rootTask, err := NewAgentExecutionRepository(db).GetTask(context.Background(), projectID, "task-terminate")
	if err != nil || rootTask.Status != "cancelled" || rootTask.Revision != 4 || rootTask.LastErrorCode != "root_failed" {
		t.Fatalf("cancelled root task = %#v, error=%v", rootTask, err)
	}
	terminalTask, err := NewAgentExecutionRepository(db).GetTask(context.Background(), projectID, "task-terminal")
	if err != nil || terminalTask.Status != "completed" || terminalTask.Revision != 2 {
		t.Fatalf("pre-terminal task = %#v, error=%v", terminalTask, err)
	}
	selection, err := selectionRepo.GetAgentSelection(projectID, "selection-terminate")
	if err != nil || selection.Status != "superseded" || selection.SupersededReason != "root_failed" {
		t.Fatalf("terminated selection = %#v, error=%v", selection, err)
	}
	event, err := NewAgentExecutionRepository(db).GetWorkflowEvent(context.Background(), projectID, "event-terminate")
	if err != nil || domain.StringValue(event.DeliveryStatus) != "discarded" || event.DiscardReason != "root_failed" {
		t.Fatalf("terminated continuation = %#v, error=%v", event, err)
	}
	session, err := NewAgentSessionRepository(db).GetAgentSession(sessionID)
	if err != nil || session.ActiveWorkflowID != nil || session.Revision != 5 {
		t.Fatalf("terminated session = %#v, error=%v", session, err)
	}
}
