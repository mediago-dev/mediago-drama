package domain

import "time"

// AgentWorkflowModel is the durable semantic scope authored by the main Agent.
type AgentWorkflowModel struct {
	ProjectID   string     `gorm:"column:project_id;primaryKey;default:'';index:agent_workflows_session_status_idx,priority:1"`
	ID          string     `gorm:"column:id;primaryKey"`
	SessionID   string     `gorm:"column:session_id;not null;index:agent_workflows_session_status_idx,priority:2"`
	RootTaskID  string     `gorm:"column:root_task_id;not null"`
	Status      string     `gorm:"column:status;not null;default:'active';index:agent_workflows_session_status_idx,priority:3"`
	GoalJSON    string     `gorm:"column:goal_json;not null;type:text;default:'{}'"`
	PlanJSON    string     `gorm:"column:plan_json;not null;type:text;default:'{}'"`
	GoalVersion uint64     `gorm:"column:goal_version;not null;default:0"`
	PlanVersion uint64     `gorm:"column:plan_version;not null;default:0"`
	Revision    uint64     `gorm:"column:revision;not null;default:1"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	CompletedAt *time.Time `gorm:"column:completed_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentWorkflowModel) TableName() string { return "agent_workflows" }

// AgentTaskModel is a logical, user-visible unit of Agent work.
type AgentTaskModel struct {
	ProjectID            string     `gorm:"column:project_id;primaryKey;default:'';index:agent_tasks_workflow_status_idx,priority:1"`
	ID                   string     `gorm:"column:id;primaryKey"`
	WorkflowID           string     `gorm:"column:workflow_id;not null;index:agent_tasks_workflow_status_idx,priority:2"`
	ParentTaskID         *string    `gorm:"column:parent_task_id;index:agent_tasks_parent_idx"`
	Role                 string     `gorm:"column:role;not null;default:'child'"`
	Name                 string     `gorm:"column:name;not null;default:''"`
	Task                 string     `gorm:"column:task;not null;type:text;default:''"`
	Status               string     `gorm:"column:status;not null;default:'pending';index:agent_tasks_workflow_status_idx,priority:3"`
	CurrentAction        string     `gorm:"column:current_action;not null;default:''"`
	Revision             uint64     `gorm:"column:revision;not null;default:1"`
	CurrentInvocationID  *string    `gorm:"column:current_invocation_id"`
	LastInvocationStatus string     `gorm:"column:last_invocation_status;not null;default:''"`
	LastErrorCode        string     `gorm:"column:last_error_code;not null;default:''"`
	StartedAt            *time.Time `gorm:"column:started_at"`
	CreatedAt            time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt            time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	CompletedAt          *time.Time `gorm:"column:completed_at"`
	MetadataJSON         string     `gorm:"column:metadata_json;not null;type:text;default:'{}'"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentTaskModel) TableName() string { return "agent_tasks" }

// AgentInvocationModel is one monotonic native ACP execution attempt.
type AgentInvocationModel struct {
	ProjectID                     string     `gorm:"column:project_id;primaryKey;default:'';index:agent_invocations_workflow_status_idx,priority:1"`
	ID                            string     `gorm:"column:id;primaryKey"`
	WorkflowID                    string     `gorm:"column:workflow_id;not null;index:agent_invocations_workflow_status_idx,priority:2"`
	TaskID                        string     `gorm:"column:task_id;not null;index:agent_invocations_task_idx"`
	ParentInvocationID            *string    `gorm:"column:parent_invocation_id"`
	RunID                         string     `gorm:"column:run_id;not null;default:'';index:agent_invocations_run_idx"`
	NativeSessionID               string     `gorm:"column:native_session_id;not null;default:''"`
	NativeThreadID                string     `gorm:"column:native_thread_id;not null;default:''"`
	NativeToolCallID              string     `gorm:"column:native_tool_call_id;not null;default:''"`
	Status                        string     `gorm:"column:status;not null;default:'pending';index:agent_invocations_workflow_status_idx,priority:3"`
	Revision                      uint64     `gorm:"column:revision;not null;default:1"`
	RootFinalChallengeHash        *string    `gorm:"column:root_final_challenge_hash"`
	RootFinalChallengeStatus      *string    `gorm:"column:root_final_challenge_status"`
	RootFinalSealTokenHash        *string    `gorm:"column:root_final_seal_token_hash"`
	RootFinalProposalSnapshotHash *string    `gorm:"column:root_final_proposal_snapshot_hash"`
	RootFinalizationSealedAt      *time.Time `gorm:"column:root_finalization_sealed_at"`
	RootFinalChallengeConsumedAt  *time.Time `gorm:"column:root_final_challenge_consumed_at"`
	StartedAt                     *time.Time `gorm:"column:started_at"`
	CreatedAt                     time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt                     time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	CompletedAt                   *time.Time `gorm:"column:completed_at"`
	MetadataJSON                  string     `gorm:"column:metadata_json;not null;type:text;default:'{}'"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentInvocationModel) TableName() string { return "agent_invocations" }

// AgentArtifactModel links a versioned workflow result to an authoritative project resource.
type AgentArtifactModel struct {
	ProjectID      string    `gorm:"column:project_id;primaryKey;default:'';index:agent_artifacts_workflow_idx,priority:1"`
	ID             string    `gorm:"column:id;primaryKey"`
	WorkflowID     string    `gorm:"column:workflow_id;not null;index:agent_artifacts_workflow_idx,priority:2"`
	ProducerTaskID string    `gorm:"column:producer_task_id;not null;default:''"`
	Version        uint64    `gorm:"column:version;not null;default:1"`
	Kind           string    `gorm:"column:kind;not null;default:'other'"`
	RefType        string    `gorm:"column:ref_type;not null;default:''"`
	RefID          string    `gorm:"column:ref_id;not null;default:''"`
	RefVersion     string    `gorm:"column:ref_version;not null;default:''"`
	RefFingerprint string    `gorm:"column:ref_fingerprint;not null;default:''"`
	Status         string    `gorm:"column:status;not null;default:'draft'"`
	Title          string    `gorm:"column:title;not null;default:''"`
	Summary        string    `gorm:"column:summary;not null;type:text;default:''"`
	MetadataJSON   string    `gorm:"column:metadata_json;not null;type:text;default:'{}'"`
	CreatedAt      time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentArtifactModel) TableName() string { return "agent_artifacts" }

// AgentWorkflowEventModel is an idempotent audit event and optional continuation delivery.
type AgentWorkflowEventModel struct {
	ProjectID             string     `gorm:"column:project_id;primaryKey;default:'';uniqueIndex:agent_workflow_events_workflow_sequence_uidx,priority:1;uniqueIndex:agent_workflow_events_idempotency_uidx,priority:1"`
	ID                    string     `gorm:"column:id;primaryKey"`
	WorkflowID            string     `gorm:"column:workflow_id;not null;uniqueIndex:agent_workflow_events_workflow_sequence_uidx,priority:2;uniqueIndex:agent_workflow_events_idempotency_uidx,priority:2"`
	Sequence              uint64     `gorm:"column:sequence;not null;default:0;uniqueIndex:agent_workflow_events_workflow_sequence_uidx,priority:3"`
	TaskID                *string    `gorm:"column:task_id"`
	InvocationID          *string    `gorm:"column:invocation_id"`
	EventType             string     `gorm:"column:event_type;not null"`
	EventVersion          uint       `gorm:"column:event_version;not null;default:1"`
	PayloadJSON           string     `gorm:"column:payload_json;not null;type:text"`
	PayloadFingerprint    string     `gorm:"column:payload_fingerprint;not null"`
	IdempotencyKey        string     `gorm:"column:idempotency_key;not null;uniqueIndex:agent_workflow_events_idempotency_uidx,priority:3"`
	CommandResultRevision uint64     `gorm:"column:command_result_revision;not null;default:0"`
	DeliveryID            *string    `gorm:"column:delivery_id;uniqueIndex:agent_workflow_events_delivery_uidx"`
	ResumeToken           *string    `gorm:"column:resume_token;uniqueIndex:agent_workflow_events_resume_uidx"`
	DeliveryStatus        *string    `gorm:"column:delivery_status;index:agent_workflow_events_delivery_status_idx"`
	LeaseOwner            *string    `gorm:"column:lease_owner"`
	LeaseUntil            *time.Time `gorm:"column:lease_until"`
	LeaseToken            uint64     `gorm:"column:lease_token;not null;default:0"`
	Attempt               uint       `gorm:"column:attempt;not null;default:0"`
	LastError             string     `gorm:"column:last_error;not null;type:text;default:''"`
	NextAttemptAt         *time.Time `gorm:"column:next_attempt_at"`
	DeliveredAt           *time.Time `gorm:"column:delivered_at"`
	AckedAt               *time.Time `gorm:"column:acked_at"`
	DiscardedAt           *time.Time `gorm:"column:discarded_at"`
	DiscardReason         string     `gorm:"column:discard_reason;not null;default:''"`
	CreatedAt             time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentWorkflowEventModel) TableName() string { return "agent_workflow_events" }

// AgentRootProposalModel is an immutable root-authority proposal awaiting strict commit.
type AgentRootProposalModel struct {
	ProjectID               string     `gorm:"column:project_id;primaryKey;default:'';uniqueIndex:agent_root_proposals_workflow_command_uidx,priority:1"`
	ID                      string     `gorm:"column:id;primaryKey"`
	WorkflowID              string     `gorm:"column:workflow_id;not null;uniqueIndex:agent_root_proposals_workflow_command_uidx,priority:2;index:agent_root_proposals_origin_status_idx,priority:1"`
	CommandID               string     `gorm:"column:command_id;not null;uniqueIndex:agent_root_proposals_workflow_command_uidx,priority:3"`
	CommandFingerprint      string     `gorm:"column:command_fingerprint;not null"`
	Action                  string     `gorm:"column:action;not null"`
	PayloadJSON             string     `gorm:"column:payload_json;not null;type:text"`
	AuthenticatedOriginJSON string     `gorm:"column:authenticated_origin_json;not null;type:text;default:'{}'"`
	OriginRootInvocationID  string     `gorm:"column:origin_root_invocation_id;not null;index:agent_root_proposals_origin_status_idx,priority:2"`
	ProposerTaskID          string     `gorm:"column:proposer_task_id;not null;default:''"`
	ProposerInvocationID    string     `gorm:"column:proposer_invocation_id;not null;default:''"`
	ExpectedGoalVersion     *uint64    `gorm:"column:expected_goal_version"`
	ExpectedPlanVersion     *uint64    `gorm:"column:expected_plan_version"`
	ExpectedTaskRevision    *uint64    `gorm:"column:expected_task_revision"`
	Status                  string     `gorm:"column:status;not null;default:'pending';index:agent_root_proposals_origin_status_idx,priority:3"`
	ProposedAt              time.Time  `gorm:"column:proposed_at;not null;autoCreateTime:nano"`
	CommittedAt             *time.Time `gorm:"column:committed_at"`
	DiscardedAt             *time.Time `gorm:"column:discarded_at"`
	DiscardReason           string     `gorm:"column:discard_reason;not null;default:''"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentRootProposalModel) TableName() string { return "agent_root_proposals" }

// AgentRootFinalDeliveryModel is the durable ordered root-final publication outbox.
type AgentRootFinalDeliveryModel struct {
	ProjectID           string     `gorm:"column:project_id;primaryKey;default:'';uniqueIndex:agent_root_final_root_invocation_uidx,priority:1;index:agent_root_final_recovery_idx,priority:1"`
	ID                  string     `gorm:"column:id;primaryKey"`
	SessionID           string     `gorm:"column:session_id;not null;index:agent_root_final_recovery_idx,priority:2"`
	WorkflowID          string     `gorm:"column:workflow_id;not null"`
	RootTaskID          string     `gorm:"column:root_task_id;not null"`
	RootInvocationID    string     `gorm:"column:root_invocation_id;not null;uniqueIndex:agent_root_final_root_invocation_uidx,priority:2"`
	RootRunID           string     `gorm:"column:root_run_id;not null"`
	MessageEventID      string     `gorm:"column:message_event_id;not null;uniqueIndex:agent_root_final_message_event_uidx"`
	RunCompletedEventID string     `gorm:"column:run_completed_event_id;not null;uniqueIndex:agent_root_final_run_event_uidx"`
	EventBundleJSON     string     `gorm:"column:event_bundle_json;not null;type:text"`
	BundleFingerprint   string     `gorm:"column:bundle_fingerprint;not null"`
	Phase               string     `gorm:"column:phase;not null;default:'pending';index:agent_root_final_recovery_idx,priority:3"`
	Revision            uint64     `gorm:"column:revision;not null;default:1"`
	FailureCode         string     `gorm:"column:failure_code;not null;default:''"`
	JSONLFirstSequence  uint64     `gorm:"column:jsonl_first_sequence;not null;default:0"`
	JSONLLastSequence   uint64     `gorm:"column:jsonl_last_sequence;not null;default:0"`
	LeaseOwner          *string    `gorm:"column:lease_owner"`
	LeaseUntil          *time.Time `gorm:"column:lease_until"`
	LeaseToken          uint64     `gorm:"column:lease_token;not null;default:0"`
	Attempt             uint       `gorm:"column:attempt;not null;default:0"`
	LastError           string     `gorm:"column:last_error;not null;type:text;default:''"`
	NextAttemptAt       *time.Time `gorm:"column:next_attempt_at"`
	CreatedAt           time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	JournaledAt         *time.Time `gorm:"column:journaled_at"`
	PublishedAt         *time.Time `gorm:"column:published_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentRootFinalDeliveryModel) TableName() string { return "agent_root_final_deliveries" }

// AgentWorkflowHandoffModel is a durable, fenced replace handoff to a successor root run.
type AgentWorkflowHandoffModel struct {
	ProjectID                  string     `gorm:"column:project_id;primaryKey;default:'';uniqueIndex:agent_workflow_handoffs_replace_uidx,priority:1;index:agent_workflow_handoffs_recovery_idx,priority:1"`
	ID                         string     `gorm:"column:id;primaryKey"`
	SessionID                  string     `gorm:"column:session_id;not null;index:agent_workflow_handoffs_recovery_idx,priority:2"`
	PredecessorWorkflowID      string     `gorm:"column:predecessor_workflow_id;not null;uniqueIndex:agent_workflow_handoffs_replace_uidx,priority:2"`
	SuccessorWorkflowID        string     `gorm:"column:successor_workflow_id;not null"`
	ReplaceCommandID           string     `gorm:"column:replace_command_id;not null;uniqueIndex:agent_workflow_handoffs_replace_uidx,priority:3"`
	ReplaceCommandFingerprint  string     `gorm:"column:replace_command_fingerprint;not null"`
	ProposalID                 string     `gorm:"column:proposal_id;not null;default:''"`
	PredecessorFinalDeliveryID string     `gorm:"column:predecessor_final_delivery_id;not null"`
	UserMessageID              string     `gorm:"column:user_message_id;not null;default:''"`
	HandoffSummaryJSON         string     `gorm:"column:handoff_summary_json;not null;type:text;default:'{}'"`
	OriginalUserMessageJSON    string     `gorm:"column:original_user_message_json;not null;type:text;default:'{}'"`
	SuccessorRootTaskID        string     `gorm:"column:successor_root_task_id;not null"`
	SuccessorInvocationID      string     `gorm:"column:successor_invocation_id;not null"`
	SuccessorRunID             string     `gorm:"column:successor_run_id;not null"`
	TargetACPSessionID         string     `gorm:"column:target_acp_session_id;not null;default:''"`
	DispatchMessageID          string     `gorm:"column:dispatch_message_id;not null;default:''"`
	DispatchFingerprint        string     `gorm:"column:dispatch_fingerprint;not null;default:''"`
	RecoveryCapability         string     `gorm:"column:recovery_capability;not null;default:''"`
	Status                     string     `gorm:"column:status;not null;default:'pending';index:agent_workflow_handoffs_recovery_idx,priority:3"`
	Revision                   uint64     `gorm:"column:revision;not null;default:1"`
	LeaseMode                  string     `gorm:"column:lease_mode;not null;default:''"`
	LeaseOwner                 *string    `gorm:"column:lease_owner"`
	LeaseUntil                 *time.Time `gorm:"column:lease_until"`
	LeaseToken                 uint64     `gorm:"column:lease_token;not null;default:0"`
	TechnicalAttemptCount      uint       `gorm:"column:technical_attempt_count;not null;default:0"`
	SendStartedAt              *time.Time `gorm:"column:send_started_at"`
	RemoteMessageID            string     `gorm:"column:remote_message_id;not null;default:''"`
	RemoteCorrelation          string     `gorm:"column:remote_correlation;not null;type:text;default:''"`
	LastError                  string     `gorm:"column:last_error;not null;type:text;default:''"`
	NextAttemptAt              *time.Time `gorm:"column:next_attempt_at"`
	CreatedAt                  time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	StartedAt                  *time.Time `gorm:"column:started_at"`
	UnknownAt                  *time.Time `gorm:"column:unknown_at"`
	FailedAt                   *time.Time `gorm:"column:failed_at"`
	CancelledAt                *time.Time `gorm:"column:cancelled_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentWorkflowHandoffModel) TableName() string { return "agent_workflow_handoffs" }

// AgentQueuedInputModel is a durable accepted user input held behind a session barrier.
type AgentQueuedInputModel struct {
	ProjectID                string     `gorm:"column:project_id;primaryKey;default:'';index:agent_queued_inputs_session_status_idx,priority:1"`
	ID                       string     `gorm:"column:id;primaryKey"`
	SessionID                string     `gorm:"column:session_id;not null;index:agent_queued_inputs_session_status_idx,priority:2"`
	AcceptedWorkflowID       *string    `gorm:"column:accepted_workflow_id"`
	DispatchWorkflowID       *string    `gorm:"column:dispatch_workflow_id"`
	UserMessageEventID       string     `gorm:"column:user_message_event_id;not null;uniqueIndex:agent_queued_inputs_user_event_uidx"`
	UserDisplayEventJSON     string     `gorm:"column:user_display_event_json;not null;type:text"`
	DisplayFingerprint       string     `gorm:"column:display_fingerprint;not null"`
	DisplayPhase             string     `gorm:"column:display_phase;not null;default:'pending'"`
	BlockedByFinalDeliveryID *string    `gorm:"column:blocked_by_final_delivery_id"`
	BlockedByHandoffID       *string    `gorm:"column:blocked_by_handoff_id"`
	Status                   string     `gorm:"column:status;not null;default:'pending';index:agent_queued_inputs_session_status_idx,priority:3"`
	Revision                 uint64     `gorm:"column:revision;not null;default:1"`
	LeaseOwner               *string    `gorm:"column:lease_owner"`
	LeaseUntil               *time.Time `gorm:"column:lease_until"`
	LeaseToken               uint64     `gorm:"column:lease_token;not null;default:0"`
	AcceptedAt               time.Time  `gorm:"column:accepted_at;not null;autoCreateTime:nano;index:agent_queued_inputs_session_status_idx,priority:4,sort:asc"`
	DispatchedAt             *time.Time `gorm:"column:dispatched_at"`
	CancelledAt              *time.Time `gorm:"column:cancelled_at"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (AgentQueuedInputModel) TableName() string { return "agent_queued_inputs" }
