# ADR-0006: Use Durable Checkpoints and the Existing Generation Dialog

## Status

Accepted

## Context

An end-to-end creative goal needs user input at important content milestones and
before creating resource-intensive image or video provider tasks. Multiple child tasks can
reach a checkpoint at the same time. Blocking the whole Workflow on one modal
would prevent unrelated work, while showing several dialogs at once would make
the interface difficult to control.

MediaGo already has a persisted AgentSelection lifecycle and hardened
generation authorization that binds a user-submitted settings snapshot to one
single or ordered batch request. It also already has a generation settings UI.
Creating a separate cost warning, approval object, or payment system would
duplicate this mechanism and does not match the desired interaction.

## Decision

Use one durable decision protocol, backed by AgentSelection, for Agent/user
checkpoints.

- Every request is correlated to a Workflow, logical requester AgentTask, source
  AgentInvocation, relay task, and optional Artifact version.
- Requests are independent. A waiting AgentTask does not make the whole Workflow
  wait, and other tasks/invocations may continue. A source invocation that has
  ended never returns to a non-terminal state.
- A root prompt ending does not expire a durable Workflow request. It remains
  pending until a decision, explicit supersession, Workflow termination, or its
  independent retention limit. Workflow decisions do not use the existing
  30-minute retrieval TTL: the first-release default is a configurable seven
  days, persisted as an absolute deadline so restarts do not reset it.
- Durable requests validate Workflow/task ownership and Artifact version instead
  of requiring their source Run to remain active. This is an additive mode;
  existing ephemeral selections retain the current run-terminal guard.
- New selections accept only four retention/kind/owner combinations: durable
  non-generation requests use `workflow + none`; deferred generation uses
  `workflow + runtime`; blocking generation uses
  `ephemeral + agent_mcp`; and legacy non-generation requests retain
  `ephemeral + none`. Other combinations are rejected except while reading
  legacy rows, so every result has exactly one receiving path.
- The UI activates at most one modal at a time and uses
  `createdAt + selectionId` as the default order. A user can choose any pending
  item from a child capsule or the existing task area's pending-decision list.
- Automatic modal queries, cache keys, reads, and decisions are scoped by the
  current project, session, and active Workflow. A project-level list must not
  surface another chat's pending request.
- Confirming or rejecting advances to the next item. Closing a modal means “deal
  with this later”: no decision is persisted and automatic queue advancement is
  paused for that interaction.
- Ordinary creative checkpoints expose approve, revise, reject, and cancel
  outcomes. A stale Artifact version supersedes the old request. Selection
  creation also snapshots the authoritative external document/asset version and
  fingerprint through a consumer-owned resolver; pending-list reconciliation,
  decision, and generation submission recheck it, so a direct document edit
  supersedes an old request even if the Agent did not republish the Artifact.
  User decisions, cancellation, supersession, expiry, and validation failure all
  use one SelectionOutcome transaction that persists the terminal result,
  creates at most one stable delivery, and reprojects the requester Task. A
  periodic restart-safe expiry worker uses the same transaction; expiration is
  never a silent list filter.
- Image and video confirmation continues to use
  `ask_user_form(kind=generation_plan)` and the existing generation settings
  dialog. The dialog's existing submit/generate action is the confirmation. Once
  clicked, the server first persists or reuses one durable
  `AgentGenerationPreparation` receipt, then automatically materializes its
  inputs and promotes it in one final transaction that persists the decision,
  validates the bound Artifact version, and writes an immutable
  generation-submission outbox with deterministic local task/batch IDs and
  provider idempotency keys. This is still one user confirmation and never opens
  another dialog. A leased worker calls the existing Generation Service only
  after promotion; it does not wait for another Agent run.
- Beginning a preparation atomically links it to the Selection and makes that
  otherwise-pending generation request processing/non-actionable. Pending-list
  APIs expose the preparation phase, but automatic modal selection, the pending
  picker, and ordinary Decide exclude it. Reloads, a paused worker, or a second
  tab therefore show one lightweight “preparing generation” fact instead of
  reopening the dialog or accepting a second command.
- The existing dialog may add or remove reference assets. Final ordered
  references therefore come from submitted settings, not blindly from the
  original intent. Every selected asset carries an opaque, selection-scoped
  server snapshot token issued for the version the UI displayed; the server
  stores only its token hash and authoritative version/fingerprint/content hash.
  Missing, stale, cross-selection, or deleted references supersede the request
  with zero provider calls.
- The generation semantic-command fingerprint covers the Selection-bound
  operation/intent version, canonical settings, and ordered reference ID plus
  ordinal. It excludes opaque snapshot tokens, client request IDs, timestamps,
  and other transport/UI fields. The first Begin validates the supplied tokens
  and freezes their resolved authoritative versions, fingerprints, and content
  hashes. Existing preparation/submission lookup compares only that semantic
  fingerprint, so refreshed valid tokens for the same semantic payload reuse the
  receipt; changed settings, IDs, or order conflict. Token expiry blocks only a
  first Begin, not replay of an existing authorized receipt.
- Deferred generation selections are Runtime-owned; legacy blocking selections
  are Agent-MCP-owned and ephemeral. Both paths use the same preparation and
  finalization path after the user clicks Generate; a later `generate_media` call
  is read-only/idempotent outcome lookup and never creates a command. Before a
  submission exists, cancellation, expiry, supersession, or
  validation/transform failure is persisted through SelectionOutcome. A runtime
  owner receives one stable `generation.confirmation.*` continuation; a blocking
  owner persists and reprojects the same result but creates no continuation, and
  its live or reconnected waiter reads the terminal row. This prevents both a
  lost waiter result and a double wakeup.
- The confirmation transaction writes one `generation.submitted` journal event
  for either owner. Runtime ownership attaches its stable continuation delivery;
  blocking ownership returns the same payload through the tool waiter and does
  not attach a submitted delivery. Once the submission later becomes terminal,
  the original waiter is gone, so either owner receives one aggregate terminal
  continuation only while its Workflow and Task remain active. Local
  task-placeholder acceptance and per-task notifications are never additional
  Agent wakeups.
- Task display state is a factual aggregate, not an event assignment. An
  actionable pending selection explicitly excludes a generation Selection with
  a `preparing|pins_ready` receipt. A non-terminal Task is `waiting_user` when
  its active current Invocation owns an actionable pending selection; otherwise
  an active current Invocation is `running`. Without one, any actionable pending
  selection yields `waiting_user`; an active preparation or non-terminal
  generation submission yields `waiting_external`; an unreplaced failed or
  interrupted current fact yields `needs_attention`; and the remainder is
  `waiting_agent`. The same transaction recomputes this state after Selection,
  preparation, submission, and Invocation changes. Thus a blocking owner keeps
  its live Invocation running during preparation, while a deferred owner does
  not reopen the dialog after restart.
- A root-authorized Task terminal transition atomically supersedes that Task's
  pending selections with reason `task_terminal` and discards all related
  unacknowledged decision, confirmation, and submitted deliveries. Existing
  provider submissions continue for reconciliation and Artifact history, but
  later facts are archived and never reopen or wake the terminal Task.
- Every pre-submission SelectionOutcome, Task terminal, Workflow cancel, and
  replace transaction locks an associated `preparing|pins_ready` receipt in the
  same order, moves it to `failed(scope_terminal|selection_terminal)`, bumps its
  fence, and invalidates its lease. A late materializer or finalizer then loses
  its CAS. If finalization already won, the submission follows the normal
  archive/reconciliation path; if another terminal outcome already won,
  recovery reuses it and never creates a second delivery. This makes cancellation,
  expiry, Artifact supersession, and scope termination mutually exclusive with
  submission promotion.
- Do not add points, cost, payment, balance, or provider-credit warning copy, and
  do not add a second confirmation dialog.
- Every new image/video provider task attempt, including a semantic retry, needs
  a new generation selection. A whole ordered batch may be confirmed once.
- The existing “Optimize and Generate” action remains available and is one
  confirmed composite outbox command, not an untracked text call followed by
  media generation. Its preparation receipt and finalization transaction freeze
  the exact optimization request, immutable media template, and deterministic
  identities for both steps. After the optimized prompt is durably stored, a
  fenced CAS materializes the final media request once. An ambiguous optimization
  call follows the same lookup-or-unknown rule and is never repeated
  automatically.
- A transport replay of an already claimed command returns its original outcome
  and must not create another provider task or another confirmation. Confirmation
  handling is lookup-first: an existing submission is returned first, otherwise
  an existing preparation receipt is resumed before reading live references,
  resolving another route, or allocating another pin namespace. Deleting a source
  after a committed request cannot turn an HTTP replay into a new failure, and a
  crash during preparation cannot turn the same click into a different command.
- The provider call happens only after the exact command and deterministic local
  identity are durable. Recovery capability is declared per request
  route/adapter, never inherited from a provider object. In the first release,
  only the verified MediaGo `openrouter.images` result lookup may reconcile an
  expired `sending` item; chat-image, ordinary OpenRouter image, and all other
  routes fail closed to `unknown`. A dedupe-only route never authorizes another
  Generate call.
- Exact steps freeze the resolved route specification and adapter-contract
  version (including provider/model/schema/limits). Dispatch does not resolve
  or compare the current route catalog and does not reapply current defaults;
  catalog changes do not invalidate an authorized request. A missing or
  incompatible frozen adapter contract fails definitely with zero provider calls
  and requires a new confirmation.
- Submission workers use owner plus a monotonic lease fence for every state
  transition. `ready`/expired `leased` may be claimed for dispatch; expired
  `sending` may only be fenced-claimed in reconcile mode. Recovery never calls
  Generate again, and a late former worker cannot overwrite the reconciler.
- Under stable asset guards, confirmation first resolves an immutable authorized
  plan containing canonical settings, the route/adapter contract, transform
  spec, and a stable plan fingerprint. Before writing the first pin, a short
  transaction persists that exact plan, the submitted settings and resolved
  reference bindings, immutable command ID/fingerprint, and all deterministic namespace and
  pin IDs in `AgentGenerationPreparation`. The server derives the preparation ID
  and audit command ID from `project_id + selection_id`; the client does not
  generate or retain an identity across reloads. The database enforces one
  preparation per that pair. The first canonical command fingerprint is
  immutable: an identical payload, network replay, reload, or second tab returns
  the same receipt, and a different fingerprint conflicts and requires a new
  Selection. Time, worker identity, and retry attempt never enter its namespace
  or pin IDs.
- Resolved bindings contain reference ID/ordinal, snapshot-row identity, and the
  authoritative version/fingerprint/content hash—not the raw opaque token. The
  raw token is discarded after first-Begin validation and must not appear in
  preparation/submission JSON, outbox payloads, errors, or raw logs.
- A preparation moves monotonically through
  `preparing -> pins_ready -> finalized`, while `preparing|pins_ready -> failed`
  is the only failure transition. It stores lease owner, expiry, monotonically
  increasing fence token, attempt/error metadata, the frozen authorized-plan
  fingerprint, and the completed pin manifest. An owner/fence CAS is required
  for every transition. An expired lease only allows another worker to reclaim
  the same receipt; it never authorizes a new receipt, another route resolution,
  another namespace, or a provider call.
- The fenced materializer creates submission-scoped source-audit and
  provider-ready pins at the receipt's deterministic IDs, using only its frozen
  plan. It writes temporary files, verifies hashes and sizes, fsyncs each temp
  file, atomically renames it, fsyncs the parent directory, and only then CASes
  `preparing -> pins_ready` with the immutable pin
  manifest. Recovery in `preparing` verifies and reuses complete deterministic
  files or recreates only missing/corrupt files from the same plan; recovery in
  `pins_ready` proceeds directly to finalization. It never rereads the current
  route catalog or changes transform defaults.
- `FinalizeWithPins` locks the same receipt and fence, revalidates the Selection,
  Artifact, references, plan fingerprint, and pin manifest, and atomically writes
  the Selection decision, exact requests, submission/outbox, submitted event,
  and `pins_ready -> finalized`. A validation or materialization failure instead
  writes `failed` together with the single pre-submission SelectionOutcome. No
  generation step is claimable and no provider call is permitted while the
  receipt is `preparing`, `pins_ready`, or `failed`.
- Preparation state is the GC authority, not a grace-period guess. GC must not
  delete a namespace or deterministic pin referenced by any `preparing` or
  `pins_ready` receipt, even when its worker lease has expired. It may collect
  failed receipts after their retention boundary, truly unreferenced temporary
  files, and finalized pins only under the submission retention rules. Therefore
  a crash between `ResolveAuthorizedPlan`, pin materialization, and
  `FinalizeWithPins` resumes the same receipt without losing confirmed inputs or
  racing orphan cleanup.
- Fault tests must stop the process after the preparation commit, after any pin
  rename, after `pins_ready`, and after the final transaction commit. They also
  race GC with expired preparation leases. Every recovery returns the same
  preparation/submission and deterministic pin IDs, GC preserves all
  `preparing|pins_ready` files, and the provider-call count remains zero until a
  finalized outbox step is claimed.
- Provider-ready bytes are hashed and persisted; dispatch may only apply
  protocol encoding such as a data URI, not compress, transcode, or reread
  defaults. Exact requests reference those pins, purpose, and order—not a mutable
  asset path or URL. The first release does not share physical blobs across
  submissions. Replacing or deleting the source cannot change an authorized
  request, while a missing/corrupt finalized pin fails definitely with zero
  provider calls.
- Existing image/video retry endpoints no longer resubmit or mutate the old
  task. They require a fresh confirmation/selection and reopen the same settings
  dialog; a semantic retry therefore receives a new submission and provider key.
- Background polling, completion notification, and asset download do not count
  as a new generation attempt and require no new confirmation.
- The confirmation UoW atomically writes one idempotent submitted event together
  with the composite outbox, before any step is claimable. Prompt-optimization
  tasks are internal lineage and never emit an Agent completion on success.
  Optimization failure/unknown terminates its item; optimization cancellation
  cancels/skips the blocked media step. Final media states roll up at item level,
  and the fully terminal submission atomically updates Artifact/result state,
  writes exactly one aggregate terminal event, and reprojects the requester Task
  using the remaining external-wait count. Its journal sequence and delivery
  dependency guarantee submitted is observed first (or earlier in one ordered
  continuation batch).
- Decision and generation completion bridges deliver facts back to the main
  Agent. They do not select the next task, retry, or complete the goal.
- If the root ACP session lease is busy, a continuation stays in a durable inbox
  and is delivered after the active root Run finishes; it never preempts that
  Run.
- Continuation delivery uses `pending -> leased -> delivered -> acked`, plus a
  durable `discarded` terminal state, an expiring lease with a monotonic fence
  token, and a stable delivery ID. It is at-least-once across the ACP boundary;
  accepted/start means delivered, while only a durable successful continuation
  terminal receipt means acked. Before crossing the ACP boundary, the worker
  CAS-checks the active Workflow/session pointer and its lease token. A crash
  between delivery and ack redelivers the same ID, while terminal/replace wins
  by discarding unacked deliveries; downstream command IDs make redelivery
  idempotent.
- Dialog dismissal and explicit cancellation are different callbacks. Close,
  Escape, or outside click means “later” and keeps the selection pending; the
  existing Cancel button records cancellation through SelectionOutcome.
  Runtime-owned requests receive the one selection-scoped cancelled observation
  described above, while a blocking owner persists/reprojects it and returns it
  only through its waiter.

## Consequences

### Positive

- The user sees one consistent confirmation model without extra billing UI.
- Concurrent child waits are representable without globally blocking work.
- Existing intent fingerprint, single-use claim, and idempotent outcome logic are
  reused and extended with a durable submission outbox instead of duplicated.
- Pending requests survive UI reloads and server restarts.

### Negative

- The current blocking ask flow needs an additive non-blocking creation mode for
  parallel orchestration.
- Generation task creation needs deterministic identity and a persistent outbox;
  providers without recovery support can only offer fail-closed `unknown`, not
  exactly-once external effects.
- Preparation adds one durable receipt and a fenced materialization lifecycle,
  but removes the otherwise unsafe dependency on process memory and GC timing
  between authorization and the final submission transaction.
- A main-Agent relay must retain requester correlation when direct child resume
  is not available.
- The shared generation dialog shell must expose separate dismiss/later and
  cancel/reject callbacks; it currently collapses both into `onOpenChange(false)`.

### Neutral

- Stable queue order is a presentation rule, not a scheduler or semantic
  priority.
- The existing dialog may be refactored into a shared presenter so both single
  and batch Agent confirmations use the same fields and visual behavior; this
  does not change generation service ownership.

## Alternatives Considered

**One global Workflow confirmation lock**

Rejected because unrelated Agents should continue while one Run waits.

**Show every pending dialog concurrently**

Rejected because overlapping modals are difficult to understand and operate.

**Add a cost-warning dialog before generation settings**

Rejected because the existing settings dialog itself is the requested
confirmation and no payment or points collection is being implemented.

**Allow retry to reuse the previous confirmation**

Rejected because the user explicitly requires every retry to be confirmed
again.

**Rely on orphan-GC grace periods during pin materialization**

Rejected because a pause or restart can outlive any fixed grace period. Without
a durable preparation receipt, GC cannot distinguish an abandoned namespace
from confirmed work that another fenced worker must resume.

## References

- ADR-0001, intent-bound Agent generation authorization
- `docs/plans/2026-07-16-agent-generation-confirmation-hardening.md`
- `docs/plans/2026-07-17-end-to-end-agent-orchestration-design.md`
