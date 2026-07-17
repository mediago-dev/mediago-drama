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

func newAgentExecutionRepositoryTest(t *testing.T) (*AgentExecutionRepository, string, string) {
	t.Helper()
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	projectID := "project-agent-execution"
	sessionID := "session-agent-execution"
	seedRepositoryProject(t, db, projectID)
	if err := NewAgentSessionRepository(db).UpsertAgentSession(domain.AgentSessionModel{
		SessionID: sessionID,
		ProjectID: projectID,
		Title:     "Execution",
	}); err != nil {
		t.Fatalf("UpsertAgentSession() error = %v", err)
	}
	return NewAgentExecutionRepository(db), projectID, sessionID
}

func seedAgentExecutionWorkflow(t *testing.T, repo *AgentExecutionRepository, projectID string, sessionID string) domain.AgentWorkflowModel {
	t.Helper()
	now := domain.TimeFromString("2026-07-17T00:00:00Z")
	workflow := domain.AgentWorkflowModel{
		ProjectID:   projectID,
		ID:          "workflow-execution",
		SessionID:   sessionID,
		RootTaskID:  "task-root",
		Status:      "active",
		GoalJSON:    `{"version":1}`,
		GoalVersion: 1,
		Revision:    1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := repo.db.Create(&workflow).Error; err != nil {
		t.Fatalf("creating workflow fixture: %v", err)
	}
	return workflow
}

func TestAgentExecutionSchemaCreatesDurableLedgerTables(t *testing.T) {
	repo, _, _ := newAgentExecutionRepositoryTest(t)
	models := []any{
		&domain.AgentWorkflowModel{},
		&domain.AgentTaskModel{},
		&domain.AgentInvocationModel{},
		&domain.AgentArtifactModel{},
		&domain.AgentWorkflowEventModel{},
		&domain.AgentRootProposalModel{},
		&domain.AgentRootFinalDeliveryModel{},
		&domain.AgentWorkflowHandoffModel{},
		&domain.AgentQueuedInputModel{},
	}
	for _, model := range models {
		if !repo.db.Migrator().HasTable(model) {
			t.Fatalf("expected table for %T", model)
		}
	}
	for _, column := range []string{
		"active_workflow_id",
		"pending_final_delivery_id",
		"root_run_lease_owner",
		"root_run_lease_until",
		"root_run_lease_token",
	} {
		if !repo.db.Migrator().HasColumn(&domain.AgentSessionModel{}, column) {
			t.Fatalf("agent_sessions missing column %q", column)
		}
	}
}

func TestAgentExecutionEventReplayIsIdempotentAndRejectsDifferentPayload(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	event := domain.AgentWorkflowEventModel{
		ProjectID:          projectID,
		ID:                 "event-command-1",
		WorkflowID:         workflow.ID,
		Sequence:           1,
		EventType:          "agent.goal.recorded",
		EventVersion:       1,
		PayloadJSON:        `{"goal":"draft"}`,
		PayloadFingerprint: "fingerprint-a",
		IdempotencyKey:     "command-1",
	}
	first, err := repo.CreateWorkflowEvent(context.Background(), event)
	if err != nil || !first.Applied {
		t.Fatalf("first CreateWorkflowEvent() = %#v, error=%v", first, err)
	}
	replay := event
	replay.ID = "event-command-replay"
	replay.Sequence = 2
	second, err := repo.CreateWorkflowEvent(context.Background(), replay)
	if err != nil || second.Applied || second.Event.ID != event.ID {
		t.Fatalf("replay CreateWorkflowEvent() = %#v, error=%v", second, err)
	}
	conflict := replay
	conflict.PayloadJSON = `{"goal":"different"}`
	conflict.PayloadFingerprint = "fingerprint-b"
	if _, err := repo.CreateWorkflowEvent(context.Background(), conflict); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("conflicting CreateWorkflowEvent() error = %v, want ErrAgentCommandConflict", err)
	}
}

func TestAgentExecutionConcurrentEventsAllocateUniqueMonotonicSequence(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	const callers = 20
	start := make(chan struct{})
	errs := make(chan error, callers)
	var group sync.WaitGroup
	for index := 0; index < callers; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			<-start
			_, err := repo.CreateWorkflowEvent(context.Background(), domain.AgentWorkflowEventModel{
				ProjectID: projectID, ID: fmt.Sprintf("event-concurrent-%02d", index), WorkflowID: workflow.ID,
				EventType: "agent.task.observed", EventVersion: 1,
				PayloadJSON:        fmt.Sprintf(`{"index":%d}`, index),
				PayloadFingerprint: fmt.Sprintf("fingerprint-%02d", index),
				IdempotencyKey:     fmt.Sprintf("concurrent-%02d", index),
			})
			errs <- err
		}(index)
	}
	close(start)
	group.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent CreateWorkflowEvent() error = %v", err)
		}
	}
	var events []domain.AgentWorkflowEventModel
	if err := repo.db.Where("project_id = ? AND workflow_id = ?", projectID, workflow.ID).Order("sequence ASC").Find(&events).Error; err != nil {
		t.Fatalf("listing concurrent workflow events: %v", err)
	}
	if len(events) != callers {
		t.Fatalf("event count = %d, want %d", len(events), callers)
	}
	for index, event := range events {
		if event.Sequence != uint64(index+1) {
			t.Fatalf("event[%d].Sequence = %d, want %d", index, event.Sequence, index+1)
		}
	}
}

func TestAgentExecutionConcurrentRootProposalCommandAppliesOnce(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	proposal := domain.AgentRootProposalModel{
		ProjectID: projectID, ID: "proposal-concurrent", WorkflowID: workflow.ID,
		CommandID: "proposal-command", CommandFingerprint: "proposal-fingerprint",
		Action: "complete_goal", PayloadJSON: `{"status":"completed"}`,
		AuthenticatedOriginJSON: `{"invocationId":"root-invocation"}`,
		OriginRootInvocationID:  "root-invocation", ProposerTaskID: workflow.RootTaskID,
		Status: "pending", ProposedAt: domain.TimeFromString("2026-07-17T00:00:30Z"),
	}
	const callers = 20
	start := make(chan struct{})
	applied := make(chan bool, callers)
	errs := make(chan error, callers)
	var group sync.WaitGroup
	for range callers {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, didApply, err := repo.CreateRootProposal(context.Background(), proposal)
			applied <- didApply
			errs <- err
		}()
	}
	close(start)
	group.Wait()
	close(applied)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent CreateRootProposal() error = %v", err)
		}
	}
	appliedCount := 0
	for didApply := range applied {
		if didApply {
			appliedCount++
		}
	}
	if appliedCount != 1 {
		t.Fatalf("root proposal applied count = %d, want 1", appliedCount)
	}
	conflict := proposal
	conflict.PayloadJSON = `{"status":"failed"}`
	if _, _, err := repo.CreateRootProposal(context.Background(), conflict); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("conflicting CreateRootProposal() error = %v, want ErrAgentCommandConflict", err)
	}
}

func TestAgentExecutionProjectionWriteSetRollsBackAtomically(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:01:00Z")
	duplicate := domain.AgentTaskModel{
		ProjectID:  projectID,
		ID:         "task-duplicate",
		WorkflowID: workflow.ID,
		Role:       "child",
		Name:       "duplicate",
		Status:     "pending",
		Revision:   1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := repo.db.Create(&duplicate).Error; err != nil {
		t.Fatalf("creating duplicate fixture: %v", err)
	}
	writeSet := AgentProjectionWriteSet{
		Event: domain.AgentWorkflowEventModel{
			ProjectID: projectID, ID: "event-atomic", WorkflowID: workflow.ID, Sequence: 1,
			EventType: "agent.task.observed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "atomic", IdempotencyKey: "atomic",
		},
		UpdateWorkflows: []AgentWorkflowCASWrite{{
			ExpectedRevision: 1,
			Next: domain.AgentWorkflowModel{
				ProjectID: projectID, ID: workflow.ID, SessionID: sessionID, RootTaskID: workflow.RootTaskID,
				Status: "failed", GoalJSON: workflow.GoalJSON, GoalVersion: workflow.GoalVersion, UpdatedAt: now, CompletedAt: &now,
			},
		}},
		CreateArtifacts: []domain.AgentArtifactModel{{
			ProjectID: projectID, ID: "artifact-atomic", WorkflowID: workflow.ID, ProducerTaskID: duplicate.ID,
			Version: 1, Kind: "screenplay", Status: "draft", CreatedAt: now, UpdatedAt: now,
		}},
		CreateTasks: []domain.AgentTaskModel{duplicate},
	}
	if _, err := repo.ApplyProjectionWriteSet(context.Background(), writeSet); err == nil {
		t.Fatal("ApplyProjectionWriteSet() error = nil, want duplicate-key failure")
	}
	for name, model := range map[string]any{
		"event":    &domain.AgentWorkflowEventModel{},
		"artifact": &domain.AgentArtifactModel{},
	} {
		var count int64
		query := repo.db.Model(model).Where("project_id = ?", projectID)
		if name == "event" {
			query = query.Where("id = ?", "event-atomic")
		} else {
			query = query.Where("id = ?", "artifact-atomic")
		}
		if err := query.Count(&count).Error; err != nil {
			t.Fatalf("counting %s: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0 after rollback", name, count)
		}
	}
	persistedWorkflow, err := repo.GetWorkflow(context.Background(), projectID, workflow.ID)
	if err != nil {
		t.Fatalf("GetWorkflow() error = %v", err)
	}
	if persistedWorkflow.Status != "active" || persistedWorkflow.Revision != 1 {
		t.Fatalf("workflow after rollback = %#v, want original active revision 1", persistedWorkflow)
	}
}

func TestAgentExecutionInvocationStatusIsMonotonicAcrossCASAndProjection(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:01:30Z")
	invocation := domain.AgentInvocationModel{
		ProjectID: projectID, ID: "invocation-monotonic", WorkflowID: workflow.ID, TaskID: workflow.RootTaskID,
		RunID: "run-monotonic", Status: "pending", Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.db.Create(&invocation).Error; err != nil {
		t.Fatalf("creating invocation fixture: %v", err)
	}
	running := invocation
	running.Status = "running"
	if ok, err := repo.CompareAndSwapInvocation(context.Background(), running, 1); err != nil || !ok {
		t.Fatalf("pending -> running = %v, error=%v", ok, err)
	}
	completed := running
	completed.Status = "completed"
	completed.CompletedAt = &now
	if ok, err := repo.CompareAndSwapInvocation(context.Background(), completed, 2); err != nil || !ok {
		t.Fatalf("running -> completed = %v, error=%v", ok, err)
	}
	regression := completed
	regression.Status = "running"
	if ok, err := repo.CompareAndSwapInvocation(context.Background(), regression, 3); err != nil || ok {
		t.Fatalf("completed -> running = %v, error=%v, want rejected", ok, err)
	}
	set := AgentProjectionWriteSet{
		Event: domain.AgentWorkflowEventModel{
			ProjectID: projectID, ID: "event-invocation-regression", WorkflowID: workflow.ID,
			EventType: "agent.invocation.regressed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "invocation-regression", IdempotencyKey: "invocation-regression",
		},
		UpdateInvocations: []AgentInvocationCASWrite{{ExpectedRevision: 3, Next: regression}},
	}
	if _, err := repo.ApplyProjectionWriteSet(context.Background(), set); !errors.Is(err, ErrAgentStaleRevision) {
		t.Fatalf("projection completed -> running error = %v, want ErrAgentStaleRevision", err)
	}
	if _, err := repo.GetWorkflowEvent(context.Background(), projectID, set.Event.ID); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("rolled back regression event error = %v, want ErrRecordNotFound", err)
	}
}

func TestAgentExecutionGenericInvocationCASPreservesRootFinalAuthorityFields(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:01:45Z")
	challengeHash := "challenge-hash"
	challengeStatus := "committed"
	sealHash := "seal-hash"
	snapshotHash := "snapshot-hash"
	invocation := domain.AgentInvocationModel{
		ProjectID: projectID, ID: "invocation-root-final-preserve", WorkflowID: workflow.ID, TaskID: workflow.RootTaskID,
		RunID: "run-root-final-preserve", Status: "running", Revision: 1,
		RootFinalChallengeHash: &challengeHash, RootFinalChallengeStatus: &challengeStatus,
		RootFinalSealTokenHash: &sealHash, RootFinalProposalSnapshotHash: &snapshotHash,
		RootFinalizationSealedAt: &now, RootFinalChallengeConsumedAt: &now,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.db.Create(&invocation).Error; err != nil {
		t.Fatal(err)
	}
	completedAt := now.Add(time.Second)
	ordinary := domain.AgentInvocationModel{
		ProjectID: projectID, ID: invocation.ID, WorkflowID: workflow.ID, TaskID: workflow.RootTaskID,
		RunID: invocation.RunID, Status: "completed", UpdatedAt: completedAt, CompletedAt: &completedAt,
	}
	if ok, err := repo.CompareAndSwapInvocation(context.Background(), ordinary, 1); err != nil || !ok {
		t.Fatalf("ordinary invocation CAS = %v, error=%v", ok, err)
	}
	spoofedChallenge := "spoofed"
	spoofedStatus := "pending"
	ordinary.RootFinalChallengeHash = &spoofedChallenge
	ordinary.RootFinalChallengeStatus = &spoofedStatus
	if ok, err := repo.CompareAndSwapInvocation(context.Background(), ordinary, 2); err != nil || !ok {
		t.Fatalf("ordinary invocation CAS with ignored authority fields = %v, error=%v", ok, err)
	}
	ordinary.RootFinalSealTokenHash = &spoofedChallenge
	if _, err := repo.ApplyProjectionWriteSet(context.Background(), AgentProjectionWriteSet{
		Event: domain.AgentWorkflowEventModel{
			ProjectID: projectID, ID: "event-root-final-preserve", WorkflowID: workflow.ID,
			EventType: "agent.invocation.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "root-final-preserve", IdempotencyKey: "root-final-preserve",
		},
		UpdateInvocations: []AgentInvocationCASWrite{{ExpectedRevision: 3, Next: ordinary}},
	}); err != nil {
		t.Fatalf("ordinary invocation projection with ignored authority fields error = %v", err)
	}
	persisted, err := repo.GetInvocation(context.Background(), projectID, invocation.ID)
	if err != nil || domain.StringValue(persisted.RootFinalChallengeHash) != challengeHash || domain.StringValue(persisted.RootFinalChallengeStatus) != challengeStatus || domain.StringValue(persisted.RootFinalSealTokenHash) != sealHash || domain.StringValue(persisted.RootFinalProposalSnapshotHash) != snapshotHash || persisted.RootFinalizationSealedAt == nil || persisted.RootFinalChallengeConsumedAt == nil {
		t.Fatalf("root-final authority fields after generic CAS = %#v, error=%v", persisted, err)
	}
}

func TestAgentExecutionArtifactVersionUsesCAS(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:02:00Z")
	base := domain.AgentArtifactModel{
		ProjectID: projectID, ID: "artifact-cas", WorkflowID: workflow.ID, ProducerTaskID: workflow.RootTaskID,
		Kind: "screenplay", RefType: "document", RefID: "document-1", RefVersion: "4", Status: "draft",
		Title: "Draft", CreatedAt: now, UpdatedAt: now,
	}
	created, applied, err := repo.PublishArtifactVersion(context.Background(), base, 0)
	if err != nil || !applied || created.Version != 1 {
		t.Fatalf("first PublishArtifactVersion() = %#v, %v, error=%v", created, applied, err)
	}
	if replayed, applied, err := repo.PublishArtifactVersion(context.Background(), base, 0); err != nil || applied || replayed.Version != 1 {
		t.Fatalf("replayed artifact create = %#v, %v, error=%v", replayed, applied, err)
	}
	conflictingCreate := base
	conflictingCreate.Title = "Different create payload"
	if _, _, err := repo.PublishArtifactVersion(context.Background(), conflictingCreate, 0); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("conflicting artifact create error = %v, want ErrAgentCommandConflict", err)
	}
	base.Title = "Revision"
	updated, applied, err := repo.PublishArtifactVersion(context.Background(), base, 1)
	if err != nil || !applied || updated.Version != 2 || updated.Title != "Revision" {
		t.Fatalf("second PublishArtifactVersion() = %#v, %v, error=%v", updated, applied, err)
	}
	base.Title = "stale"
	if _, applied, err := repo.PublishArtifactVersion(context.Background(), base, 1); err != nil || applied {
		t.Fatalf("stale PublishArtifactVersion() applied=%v error=%v, want false,nil", applied, err)
	}
	base.Title = "Concurrent revision"
	const callers = 20
	start := make(chan struct{})
	results := make(chan bool, callers)
	errorsCh := make(chan error, callers)
	var group sync.WaitGroup
	for range callers {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, applied, err := repo.PublishArtifactVersion(context.Background(), base, 2)
			results <- applied
			errorsCh <- err
		}()
	}
	close(start)
	group.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		if err != nil {
			t.Fatalf("concurrent PublishArtifactVersion() error = %v", err)
		}
	}
	appliedCount := 0
	for applied := range results {
		if applied {
			appliedCount++
		}
	}
	if appliedCount != 1 {
		t.Fatalf("concurrent artifact applied count = %d, want 1", appliedCount)
	}
	finalArtifact, err := repo.GetArtifact(context.Background(), projectID, base.ID)
	if err != nil || finalArtifact.Version != 3 {
		t.Fatalf("final artifact = %#v, error=%v", finalArtifact, err)
	}
}

func TestAgentExecutionContinuationLeaseAckAndDiscard(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:00Z")
	for _, id := range []string{"continuation-ack", "continuation-discard"} {
		deliveryID := "delivery-" + id
		resumeToken := "resume-" + id
		status := "pending"
		event := domain.AgentWorkflowEventModel{
			ProjectID: projectID, ID: id, WorkflowID: workflow.ID, Sequence: uint64(len(id)),
			EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: id, IdempotencyKey: id,
			DeliveryID: &deliveryID, ResumeToken: &resumeToken, DeliveryStatus: &status,
		}
		if err := repo.db.Create(&event).Error; err != nil {
			t.Fatalf("creating continuation %q: %v", id, err)
		}
	}
	if _, ok, err := repo.ClaimContinuation(context.Background(), projectID, "continuation-ack", "", now, now.Add(time.Minute)); !errors.Is(err, ErrAgentInvalidCAS) || ok {
		t.Fatalf("empty-owner ClaimContinuation() = %v, error=%v", ok, err)
	}
	if _, ok, err := repo.ClaimContinuation(context.Background(), projectID, "continuation-ack", "worker-a", now, now); !errors.Is(err, ErrAgentInvalidCAS) || ok {
		t.Fatalf("expired ClaimContinuation() = %v, error=%v", ok, err)
	}
	claimed, ok, err := repo.ClaimContinuation(context.Background(), projectID, "continuation-ack", "worker-a", now, now.Add(time.Minute))
	if err != nil || !ok || claimed.LeaseToken != 1 || domain.StringValue(claimed.DeliveryStatus) != "leased" {
		t.Fatalf("ClaimContinuation() = %#v, %v, error=%v", claimed, ok, err)
	}
	if ok, err := repo.MarkContinuationDelivered(context.Background(), projectID, claimed.ID, "", 0, now.Add(time.Second)); !errors.Is(err, ErrAgentInvalidCAS) || ok {
		t.Fatalf("invalid MarkContinuationDelivered() = %v, error=%v", ok, err)
	}
	if ok, err := repo.MarkContinuationDelivered(context.Background(), projectID, claimed.ID, "worker-a", claimed.LeaseToken, now.Add(time.Second)); err != nil || !ok {
		t.Fatalf("MarkContinuationDelivered() = %v, error=%v", ok, err)
	}
	if ok, err := repo.AckContinuation(context.Background(), projectID, claimed.ID, "worker-a", claimed.LeaseToken, now.Add(2*time.Second)); err != nil || !ok {
		t.Fatalf("AckContinuation() = %v, error=%v", ok, err)
	}
	if ok, err := repo.MarkContinuationDelivered(context.Background(), projectID, claimed.ID, "stale-worker", claimed.LeaseToken, now.Add(3*time.Second)); err != nil || ok {
		t.Fatalf("stale MarkContinuationDelivered() = %v, error=%v", ok, err)
	}
	if ok, err := repo.DiscardContinuation(context.Background(), projectID, "continuation-discard", "workflow_terminal", now.Add(time.Second)); err != nil || !ok {
		t.Fatalf("DiscardContinuation() = %v, error=%v", ok, err)
	}
	discarded, err := repo.GetWorkflowEvent(context.Background(), projectID, "continuation-discard")
	if err != nil || domain.StringValue(discarded.DeliveryStatus) != "discarded" || discarded.LeaseToken != 1 {
		t.Fatalf("discarded continuation = %#v, error=%v", discarded, err)
	}
}

func TestAgentExecutionExpiredLeasesCannotTransition(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:20Z")
	expiredAt := now.Add(-time.Second)
	owner := "expired-worker"
	deliveryID := "delivery-expired"
	status := "leased"
	if err := repo.db.Create(&domain.AgentWorkflowEventModel{
		ProjectID: projectID, ID: "continuation-expired", WorkflowID: workflow.ID, Sequence: 1,
		EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "continuation-expired", IdempotencyKey: "continuation-expired",
		DeliveryID: &deliveryID, DeliveryStatus: &status, LeaseOwner: &owner, LeaseUntil: &expiredAt, LeaseToken: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := repo.MarkContinuationDelivered(context.Background(), projectID, "continuation-expired", owner, 1, now); err != nil || ok {
		t.Fatalf("expired continuation transition = %v, error=%v", ok, err)
	}
	rootFinal := domain.AgentRootFinalDeliveryModel{
		ProjectID: projectID, ID: "root-final-expired", SessionID: sessionID, WorkflowID: workflow.ID,
		RootTaskID: workflow.RootTaskID, RootInvocationID: "invocation-expired", RootRunID: "run-expired",
		MessageEventID: "message-expired", RunCompletedEventID: "run-event-expired", EventBundleJSON: `[]`, BundleFingerprint: "root-final-expired",
		Phase: "pending", Revision: 1, LeaseOwner: &owner, LeaseUntil: &expiredAt, LeaseToken: 1, CreatedAt: now,
	}
	if err := repo.db.Create(&rootFinal).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), AgentRootFinalDeliveryTransition{
		ProjectID: projectID, SessionID: sessionID, DeliveryID: rootFinal.ID, ExpectedPhase: "pending", NextPhase: "failed", ExpectedRevision: 1,
		LeaseOwner: owner, LeaseToken: 1, CommandID: "expired-root-final", CommandFingerprint: "expired-root-final", At: now,
	}); !errors.Is(err, ErrAgentStaleFence) {
		t.Fatalf("expired root-final transition error = %v, want ErrAgentStaleFence", err)
	}
	handoff := domain.AgentWorkflowHandoffModel{
		ProjectID: projectID, ID: "handoff-expired", SessionID: sessionID, PredecessorWorkflowID: workflow.ID,
		SuccessorWorkflowID: "workflow-next", ReplaceCommandID: "replace-expired", ReplaceCommandFingerprint: "replace-expired",
		PredecessorFinalDeliveryID: rootFinal.ID, SuccessorRootTaskID: "task-next", SuccessorInvocationID: "invocation-next", SuccessorRunID: "run-next",
		Status: "leased", Revision: 1, LeaseMode: "dispatch", LeaseOwner: &owner, LeaseUntil: &expiredAt, LeaseToken: 1, CreatedAt: now,
	}
	if err := repo.db.Create(&handoff).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.TransitionWorkflowHandoff(context.Background(), AgentWorkflowHandoffTransition{
		ProjectID: projectID, SessionID: sessionID, HandoffID: handoff.ID, ExpectedStatus: "leased", NextStatus: "sending", ExpectedRevision: 1,
		LeaseOwner: owner, LeaseToken: 1, CommandID: "expired-handoff", CommandFingerprint: "expired-handoff", At: now,
	}); !errors.Is(err, ErrAgentStaleFence) {
		t.Fatalf("expired handoff transition error = %v, want ErrAgentStaleFence", err)
	}
}

func TestAgentExecutionRootFinalDeliveryUsesRevisionFenceAndCommandIdempotency(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:30Z")
	delivery := domain.AgentRootFinalDeliveryModel{
		ProjectID: projectID, ID: "root-final-transition", SessionID: sessionID, WorkflowID: workflow.ID,
		RootTaskID: workflow.RootTaskID, RootInvocationID: "root-invocation-transition", RootRunID: "root-run-transition",
		MessageEventID: "message-transition", RunCompletedEventID: "run-completed-transition",
		EventBundleJSON: `[]`, BundleFingerprint: "bundle-transition", Phase: "pending", Revision: 7, CreatedAt: now,
	}
	if err := repo.db.Create(&delivery).Error; err != nil {
		t.Fatalf("creating root final delivery: %v", err)
	}
	claimed, ok, err := repo.ClaimRootFinalDelivery(context.Background(), projectID, sessionID, delivery.ID, "publisher-a", now, now.Add(time.Minute))
	if err != nil || !ok || claimed.Revision != 7 || claimed.LeaseToken != 1 {
		t.Fatalf("ClaimRootFinalDelivery() = %#v, %v, error=%v", claimed, ok, err)
	}
	transition := AgentRootFinalDeliveryTransition{
		ProjectID: projectID, SessionID: sessionID, DeliveryID: delivery.ID,
		ExpectedPhase: "pending", NextPhase: "journaled", ExpectedRevision: 7,
		LeaseOwner: "publisher-a", LeaseToken: claimed.LeaseToken,
		CommandID: "journal-command", CommandFingerprint: "journal-fingerprint", ResultJSON: `{"phase":"journaled","revision":8}`,
		JSONLFirstSequence: 10, JSONLLastSequence: 11, At: now.Add(time.Second),
	}
	first, err := repo.TransitionRootFinalDelivery(context.Background(), transition)
	if err != nil || !first.Applied || first.Revision != 8 || first.ResultJSON != transition.ResultJSON {
		t.Fatalf("TransitionRootFinalDelivery() = %#v, error=%v", first, err)
	}
	replayed, err := repo.TransitionRootFinalDelivery(context.Background(), transition)
	if err != nil || replayed.Applied || replayed.Revision != 8 || replayed.ResultJSON != transition.ResultJSON {
		t.Fatalf("replayed TransitionRootFinalDelivery() = %#v, error=%v", replayed, err)
	}
	conflict := transition
	conflict.CommandFingerprint = "different-fingerprint"
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), conflict); !errors.Is(err, ErrAgentCommandConflict) {
		t.Fatalf("conflicting TransitionRootFinalDelivery() error = %v", err)
	}
	publish := transition
	publish.ExpectedPhase = "journaled"
	publish.NextPhase = "published"
	publish.ExpectedRevision = 8
	publish.CommandID = "publish-command"
	publish.CommandFingerprint = "publish-fingerprint"
	publish.ResultJSON = `{"phase":"published","revision":9}`
	publish.JSONLFirstSequence = 0
	publish.JSONLLastSequence = 0
	if result, err := repo.TransitionRootFinalDelivery(context.Background(), publish); err != nil || !result.Applied || result.Revision != 9 {
		t.Fatalf("publish TransitionRootFinalDelivery() = %#v, error=%v", result, err)
	}
	persisted, err := repo.GetRootFinalDelivery(context.Background(), projectID, sessionID, delivery.ID)
	if err != nil || persisted.JSONLFirstSequence != 10 || persisted.JSONLLastSequence != 11 {
		t.Fatalf("published root-final sequence range = %#v, error=%v", persisted, err)
	}
	stale := transition
	stale.CommandID = "stale-command"
	stale.CommandFingerprint = "stale-fingerprint"
	stale.ExpectedPhase = "journaled"
	stale.NextPhase = "published"
	stale.ExpectedRevision = 8
	stale.LeaseToken = claimed.LeaseToken + 1
	stale.JSONLFirstSequence = 0
	stale.JSONLLastSequence = 0
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), stale); !errors.Is(err, ErrAgentStaleFence) {
		t.Fatalf("stale TransitionRootFinalDelivery() error = %v, want ErrAgentStaleFence", err)
	}
}

func TestAgentExecutionRootFinalJournalSequenceValidation(t *testing.T) {
	tests := []struct {
		name      string
		nextPhase string
		first     uint64
		last      uint64
	}{
		{name: "missing", nextPhase: "journaled", first: 0, last: 0},
		{name: "missing first", nextPhase: "journaled", first: 0, last: 4},
		{name: "reversed", nextPhase: "journaled", first: 5, last: 4},
		{name: "range on non journal transition", nextPhase: "failed", first: 5, last: 6},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := AgentRootFinalDeliveryTransition{
				ProjectID: "project", SessionID: "session", DeliveryID: "delivery",
				ExpectedPhase: "pending", NextPhase: tt.nextPhase, ExpectedRevision: 1,
				LeaseOwner: "owner", LeaseToken: 1, CommandID: "command", CommandFingerprint: "fingerprint",
				JSONLFirstSequence: tt.first, JSONLLastSequence: tt.last, At: time.Now(),
			}
			if validRootFinalSequenceTransition(input) {
				t.Fatalf("sequence range %d..%d accepted", tt.first, tt.last)
			}
		})
	}
}

func TestAgentExecutionFailedRootFinalReconcileRequiresScopedRevisionAndFence(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:45Z")
	delivery := domain.AgentRootFinalDeliveryModel{
		ProjectID: projectID, ID: "root-final-failed", SessionID: sessionID, WorkflowID: workflow.ID,
		RootTaskID: workflow.RootTaskID, RootInvocationID: "root-invocation-failed", RootRunID: "root-run-failed",
		MessageEventID: "message-failed-reconcile", RunCompletedEventID: "run-completed-failed-reconcile",
		EventBundleJSON: `[]`, BundleFingerprint: "bundle-failed-reconcile", Phase: "failed", FailureCode: "journal_conflict",
		Revision: 3, CreatedAt: now,
	}
	if err := repo.db.Create(&delivery).Error; err != nil {
		t.Fatalf("creating failed delivery: %v", err)
	}
	if _, ok, err := repo.ClaimRootFinalDelivery(context.Background(), projectID, sessionID, delivery.ID, "automatic-publisher", now, now.Add(time.Minute)); err != nil || ok {
		t.Fatalf("automatic claim of failed delivery = %v, error=%v, want recovery issue only", ok, err)
	}
	owner := "reconciler"
	claimed, ok, err := repo.ClaimFailedRootFinalDeliveryForReconcile(context.Background(), projectID, sessionID, delivery.ID, owner, now, now.Add(time.Minute))
	if err != nil || !ok || claimed.LeaseToken != 1 || domain.StringValue(claimed.LeaseOwner) != owner {
		t.Fatalf("ClaimFailedRootFinalDeliveryForReconcile() = %#v, %v, error=%v", claimed, ok, err)
	}
	base := AgentRootFinalDeliveryTransition{
		ProjectID: projectID, SessionID: sessionID, DeliveryID: delivery.ID,
		ExpectedPhase: "failed", NextPhase: "pending", ExpectedRevision: 3,
		LeaseOwner: owner, LeaseToken: claimed.LeaseToken, CommandID: "reconcile-command", CommandFingerprint: "reconcile-fingerprint",
		ResultJSON: `{"phase":"pending","revision":4}`, At: now.Add(time.Second),
	}
	missingCommand := base
	missingCommand.CommandID = ""
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), missingCommand); !errors.Is(err, ErrAgentInvalidCAS) {
		t.Fatalf("missing command error = %v, want ErrAgentInvalidCAS", err)
	}
	wrongSession := base
	wrongSession.CommandID = "wrong-session-command"
	wrongSession.SessionID = "session-other"
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), wrongSession); !errors.Is(err, ErrAgentStaleRevision) {
		t.Fatalf("wrong session error = %v, want ErrAgentStaleRevision", err)
	}
	result, err := repo.TransitionRootFinalDelivery(context.Background(), base)
	if err != nil || !result.Applied || result.Revision != 4 {
		t.Fatalf("reconcile TransitionRootFinalDelivery() = %#v, error=%v", result, err)
	}
}

func TestAgentExecutionFencedTransitionsRejectStateMachineSkips(t *testing.T) {
	if allowedHandoffTransition("unknown", "failed_definite") {
		t.Fatal("unknown -> failed_definite must require authoritative absent reconcile and must not be allowed")
	}
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:48Z")
	owner := "publisher"
	leaseUntil := now.Add(time.Minute)
	delivery := domain.AgentRootFinalDeliveryModel{
		ProjectID: projectID, ID: "root-final-no-skip", SessionID: sessionID, WorkflowID: workflow.ID,
		RootTaskID: workflow.RootTaskID, RootInvocationID: "root-invocation-no-skip", RootRunID: "root-run-no-skip",
		MessageEventID: "message-no-skip", RunCompletedEventID: "run-completed-no-skip",
		EventBundleJSON: `[]`, BundleFingerprint: "bundle-no-skip", Phase: "pending", Revision: 1,
		LeaseOwner: &owner, LeaseUntil: &leaseUntil, LeaseToken: 1, CreatedAt: now,
	}
	if err := repo.db.Create(&delivery).Error; err != nil {
		t.Fatalf("creating root-final transition fixture: %v", err)
	}
	if _, err := repo.TransitionRootFinalDelivery(context.Background(), AgentRootFinalDeliveryTransition{
		ProjectID: projectID, SessionID: sessionID, DeliveryID: delivery.ID,
		ExpectedPhase: "pending", NextPhase: "published", ExpectedRevision: 1,
		LeaseOwner: owner, LeaseToken: 1, CommandID: "skip-journal", CommandFingerprint: "skip-journal",
		ResultJSON: `{}`, At: now,
	}); !errors.Is(err, ErrAgentInvalidCAS) {
		t.Fatalf("pending -> published error = %v, want ErrAgentInvalidCAS", err)
	}

	handoff := domain.AgentWorkflowHandoffModel{
		ProjectID: projectID, ID: "handoff-no-skip", SessionID: sessionID,
		PredecessorWorkflowID: workflow.ID, SuccessorWorkflowID: "workflow-next", ReplaceCommandID: "replace-no-skip",
		ReplaceCommandFingerprint: "replace-no-skip", PredecessorFinalDeliveryID: delivery.ID,
		SuccessorRootTaskID: "task-next", SuccessorInvocationID: "invocation-next", SuccessorRunID: "run-next",
		Status: "leased", Revision: 1, LeaseMode: "dispatch", LeaseOwner: &owner, LeaseUntil: &leaseUntil, LeaseToken: 1, CreatedAt: now,
	}
	if err := repo.db.Create(&handoff).Error; err != nil {
		t.Fatalf("creating handoff transition fixture: %v", err)
	}
	if _, err := repo.TransitionWorkflowHandoff(context.Background(), AgentWorkflowHandoffTransition{
		ProjectID: projectID, SessionID: sessionID, HandoffID: handoff.ID,
		ExpectedStatus: "leased", NextStatus: "started", ExpectedRevision: 1,
		LeaseOwner: owner, LeaseToken: 1, CommandID: "skip-sending", CommandFingerprint: "skip-sending",
		ResultJSON: `{}`, At: now,
	}); !errors.Is(err, ErrAgentInvalidCAS) {
		t.Fatalf("leased -> started error = %v, want ErrAgentInvalidCAS", err)
	}
	if _, ok, err := repo.ClaimWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID, "dispatch", []string{"unknown"}, owner, now.Add(2*time.Minute), now.Add(3*time.Minute)); !errors.Is(err, ErrAgentInvalidCAS) || ok {
		t.Fatalf("dispatch claim of unknown handoff = %v, error=%v, want ErrAgentInvalidCAS", ok, err)
	}
}

func TestAgentExecutionWorkflowHandoffKeepsRevisionSeparateFromLeaseFence(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:03:50Z")
	handoff := domain.AgentWorkflowHandoffModel{
		ProjectID: projectID, ID: "handoff-transition", SessionID: sessionID,
		PredecessorWorkflowID: workflow.ID, SuccessorWorkflowID: "workflow-successor", ReplaceCommandID: "replace-handoff",
		ReplaceCommandFingerprint: "replace-handoff-fingerprint", PredecessorFinalDeliveryID: "delivery-predecessor",
		SuccessorRootTaskID: "task-successor", SuccessorInvocationID: "invocation-successor", SuccessorRunID: "run-successor",
		Status: "pending", Revision: 5, CreatedAt: now,
	}
	if err := repo.db.Create(&handoff).Error; err != nil {
		t.Fatalf("creating handoff: %v", err)
	}
	claimed, ok, err := repo.ClaimWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID, "dispatch", []string{"pending"}, "worker-a", now, now.Add(time.Minute))
	if err != nil || !ok || claimed.Status != "leased" || claimed.Revision != 5 || claimed.LeaseToken != 1 {
		t.Fatalf("ClaimWorkflowHandoff() = %#v, %v, error=%v", claimed, ok, err)
	}
	transition := AgentWorkflowHandoffTransition{
		ProjectID: projectID, SessionID: sessionID, HandoffID: handoff.ID,
		ExpectedStatus: "leased", NextStatus: "sending", ExpectedRevision: 5,
		LeaseOwner: "worker-a", LeaseToken: claimed.LeaseToken,
		CommandID: "handoff-sending", CommandFingerprint: "handoff-sending-fingerprint",
		ResultJSON: `{"status":"sending","revision":6}`, RemoteMessageID: "remote-message-1",
		RemoteCorrelation: `{"requestId":"remote-request-1"}`, At: now.Add(time.Second),
	}
	result, err := repo.TransitionWorkflowHandoff(context.Background(), transition)
	if err != nil || !result.Applied || result.Revision != 6 {
		t.Fatalf("TransitionWorkflowHandoff() = %#v, error=%v", result, err)
	}
	dispatchReverse := transition
	dispatchReverse.ExpectedStatus = "sending"
	dispatchReverse.NextStatus = "pending"
	dispatchReverse.ExpectedRevision = 6
	dispatchReverse.CommandID = "handoff-dispatch-reverse"
	dispatchReverse.CommandFingerprint = "handoff-dispatch-reverse-fingerprint"
	if _, err := repo.TransitionWorkflowHandoff(context.Background(), dispatchReverse); !errors.Is(err, ErrAgentInvalidCAS) {
		t.Fatalf("dispatch sending -> pending error = %v, want ErrAgentInvalidCAS", err)
	}
	postSendFailure := dispatchReverse
	postSendFailure.NextStatus = "failed_definite"
	postSendFailure.CommandID = "handoff-post-send-failed-definite"
	postSendFailure.CommandFingerprint = "handoff-post-send-failed-definite-fingerprint"
	if _, err := repo.TransitionWorkflowHandoff(context.Background(), postSendFailure); !errors.Is(err, ErrAgentInvalidCAS) {
		t.Fatalf("sending -> failed_definite error = %v, want ErrAgentInvalidCAS", err)
	}
	stale := transition
	stale.CommandID = "handoff-stale"
	stale.CommandFingerprint = "handoff-stale-fingerprint"
	stale.ExpectedStatus = "sending"
	stale.NextStatus = "unknown"
	stale.ExpectedRevision = 6
	stale.LeaseToken = claimed.LeaseToken + 1
	if _, err := repo.TransitionWorkflowHandoff(context.Background(), stale); !errors.Is(err, ErrAgentStaleFence) {
		t.Fatalf("stale TransitionWorkflowHandoff() error = %v", err)
	}
	reconcileClaim, ok, err := repo.ClaimWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID, "reconcile_only", []string{"sending"}, "worker-b", now.Add(2*time.Minute), now.Add(3*time.Minute))
	if err != nil || !ok || reconcileClaim.Status != "sending" || reconcileClaim.Revision != 6 || reconcileClaim.LeaseToken != 2 || reconcileClaim.LeaseMode != "reconcile_only" {
		t.Fatalf("reconcile ClaimWorkflowHandoff() = %#v, %v, error=%v", reconcileClaim, ok, err)
	}
	reconcile := AgentWorkflowHandoffTransition{
		ProjectID: projectID, SessionID: sessionID, HandoffID: handoff.ID,
		ExpectedStatus: "sending", NextStatus: "pending", ExpectedRevision: 6,
		LeaseOwner: "worker-b", LeaseToken: reconcileClaim.LeaseToken,
		CommandID: "handoff-reconciled-absent", CommandFingerprint: "handoff-reconciled-absent-fingerprint",
		ResultJSON: `{"status":"pending","revision":7}`, At: now.Add(2*time.Minute + time.Second),
	}
	reconciled, err := repo.TransitionWorkflowHandoff(context.Background(), reconcile)
	if err != nil || !reconciled.Applied || reconciled.Revision != 7 {
		t.Fatalf("reconcile sending -> pending = %#v, error=%v", reconciled, err)
	}
	persisted, err := repo.GetWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID)
	if err != nil || persisted.Status != "pending" || persisted.Revision != 7 || persisted.LeaseOwner != nil || persisted.LeaseToken != 3 || persisted.RemoteMessageID != "remote-message-1" || persisted.RemoteCorrelation != `{"requestId":"remote-request-1"}` {
		t.Fatalf("reconciled handoff = %#v, error=%v", persisted, err)
	}
}

func TestAgentExecutionRecoverableStateSeparatesPublisherIssues(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:04:00Z")
	pending := "pending"
	deliveryID := "delivery-recoverable"
	resumeToken := "resume-recoverable"
	if err := repo.db.Create(&domain.AgentWorkflowEventModel{
		ProjectID: projectID, ID: "event-recoverable", WorkflowID: workflow.ID, Sequence: 1,
		EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "recoverable", IdempotencyKey: "recoverable",
		DeliveryID: &deliveryID, ResumeToken: &resumeToken, DeliveryStatus: &pending,
	}).Error; err != nil {
		t.Fatalf("creating recoverable continuation: %v", err)
	}
	for _, fixture := range []domain.AgentRootFinalDeliveryModel{
		{ProjectID: projectID, ID: "delivery-pending", SessionID: sessionID, WorkflowID: workflow.ID, RootTaskID: workflow.RootTaskID, RootInvocationID: "invocation-pending", RootRunID: "run-pending", MessageEventID: "message-pending", RunCompletedEventID: "run-event-pending", EventBundleJSON: `[]`, BundleFingerprint: "pending", Phase: "pending", Revision: 1, CreatedAt: now},
		{ProjectID: projectID, ID: "delivery-failed", SessionID: sessionID, WorkflowID: workflow.ID, RootTaskID: workflow.RootTaskID, RootInvocationID: "invocation-failed", RootRunID: "run-failed", MessageEventID: "message-failed", RunCompletedEventID: "run-event-failed", EventBundleJSON: `[]`, BundleFingerprint: "failed", Phase: "failed", FailureCode: "journal_conflict", Revision: 4, CreatedAt: now},
	} {
		if err := repo.db.Create(&fixture).Error; err != nil {
			t.Fatalf("creating root final fixture %q: %v", fixture.ID, err)
		}
	}
	if err := repo.db.Create(&domain.AgentWorkflowHandoffModel{
		ProjectID: projectID, ID: "handoff-unknown", SessionID: sessionID,
		PredecessorWorkflowID: workflow.ID, SuccessorWorkflowID: "workflow-next", ReplaceCommandID: "replace-1",
		ReplaceCommandFingerprint: "replace-fingerprint", PredecessorFinalDeliveryID: "delivery-pending",
		SuccessorRootTaskID: "task-next", SuccessorInvocationID: "invocation-next", SuccessorRunID: "run-next",
		Status: "unknown", Revision: 2, CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("creating handoff fixture: %v", err)
	}
	state, err := repo.ListRecoverable(context.Background(), projectID)
	if err != nil {
		t.Fatalf("ListRecoverable() error = %v", err)
	}
	if len(state.ActiveWorkflows) != 1 || len(state.Continuations) != 1 || len(state.PublishableRootFinalDeliveries) != 1 || len(state.FailedRootFinalDeliveries) != 1 || len(state.WorkflowHandoffs) != 1 {
		t.Fatalf("recoverable state = %#v", state)
	}
}

func TestAgentExecutionClaimsRespectNextAttemptBackoff(t *testing.T) {
	repo, projectID, sessionID := newAgentExecutionRepositoryTest(t)
	workflow := seedAgentExecutionWorkflow(t, repo, projectID, sessionID)
	now := domain.TimeFromString("2026-07-17T00:05:00Z")
	nextAttempt := now.Add(time.Minute)
	deliveryID := "delivery-backoff"
	resumeToken := "resume-backoff"
	deliveryStatus := "pending"
	if err := repo.db.Create(&domain.AgentWorkflowEventModel{
		ProjectID: projectID, ID: "continuation-backoff", WorkflowID: workflow.ID, Sequence: 1,
		EventType: "agent.decision.completed", EventVersion: 1, PayloadJSON: `{}`, PayloadFingerprint: "continuation-backoff", IdempotencyKey: "continuation-backoff",
		DeliveryID: &deliveryID, ResumeToken: &resumeToken, DeliveryStatus: &deliveryStatus, NextAttemptAt: &nextAttempt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	rootFinal := domain.AgentRootFinalDeliveryModel{
		ProjectID: projectID, ID: "root-final-backoff", SessionID: sessionID, WorkflowID: workflow.ID,
		RootTaskID: workflow.RootTaskID, RootInvocationID: "invocation-backoff", RootRunID: "run-backoff",
		MessageEventID: "message-backoff", RunCompletedEventID: "run-event-backoff", EventBundleJSON: `[]`, BundleFingerprint: "root-final-backoff",
		Phase: "pending", Revision: 1, NextAttemptAt: &nextAttempt, CreatedAt: now,
	}
	if err := repo.db.Create(&rootFinal).Error; err != nil {
		t.Fatal(err)
	}
	handoff := domain.AgentWorkflowHandoffModel{
		ProjectID: projectID, ID: "handoff-backoff", SessionID: sessionID, PredecessorWorkflowID: workflow.ID,
		SuccessorWorkflowID: "workflow-backoff-next", ReplaceCommandID: "replace-backoff", ReplaceCommandFingerprint: "replace-backoff",
		PredecessorFinalDeliveryID: rootFinal.ID, SuccessorRootTaskID: "task-next", SuccessorInvocationID: "invocation-next", SuccessorRunID: "run-next",
		Status: "pending", Revision: 1, NextAttemptAt: &nextAttempt, CreatedAt: now,
	}
	if err := repo.db.Create(&handoff).Error; err != nil {
		t.Fatal(err)
	}
	if _, ok, err := repo.ClaimContinuation(context.Background(), projectID, "continuation-backoff", "worker", now, now.Add(30*time.Second)); err != nil || ok {
		t.Fatalf("early continuation claim = %v, error=%v", ok, err)
	}
	if _, ok, err := repo.ClaimRootFinalDelivery(context.Background(), projectID, sessionID, rootFinal.ID, "worker", now, now.Add(30*time.Second)); err != nil || ok {
		t.Fatalf("early root-final claim = %v, error=%v", ok, err)
	}
	if _, ok, err := repo.ClaimWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID, "dispatch", []string{"pending"}, "worker", now, now.Add(30*time.Second)); err != nil || ok {
		t.Fatalf("early handoff claim = %v, error=%v", ok, err)
	}
	claimAt := nextAttempt
	if _, ok, err := repo.ClaimContinuation(context.Background(), projectID, "continuation-backoff", "worker", claimAt, claimAt.Add(time.Minute)); err != nil || !ok {
		t.Fatalf("due continuation claim = %v, error=%v", ok, err)
	}
	if _, ok, err := repo.ClaimRootFinalDelivery(context.Background(), projectID, sessionID, rootFinal.ID, "worker", claimAt, claimAt.Add(time.Minute)); err != nil || !ok {
		t.Fatalf("due root-final claim = %v, error=%v", ok, err)
	}
	if _, ok, err := repo.ClaimWorkflowHandoff(context.Background(), projectID, sessionID, handoff.ID, "dispatch", []string{"pending"}, "worker", claimAt, claimAt.Add(time.Minute)); err != nil || !ok {
		t.Fatalf("due handoff claim = %v, error=%v", ok, err)
	}
}
