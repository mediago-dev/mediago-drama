# ADR-0004: Keep the Main Agent Sovereign and the Runtime Passive

## Status

Accepted

## Context

MediaGo currently exposes separate writing, character, scene, storyboard, image,
and video capabilities. The requested experience is an end-to-end flow in which
one main Agent understands the user's actual goal and takes the work only as far
as requested. The main Agent must also be able to perform simple work itself and
use native child Agents when delegation is useful.

A conventional workflow engine could encode a fixed sequence and decide when to
dispatch workers. That would duplicate the model's planning ability and would
make a request such as “only write the screenplay” vulnerable to continuing into
storyboards or media. It would also restrict the Agent's ability to change its
plan, combine tasks, or avoid unnecessary delegation.

Durability is still required. User decisions and media tasks can outlive one ACP
prompt, child work can overlap, and the server can restart while work is waiting.

## Decision

The main Agent is the sole semantic authority for a goal.

- The Agent interprets scope, requested deliverables, exclusions, and the stop
  condition.
- The Agent owns planning, direct execution, native child-Agent delegation,
  parallelism, replanning, result synthesis, semantic retry, and completion.
- The Agent records a versioned GoalContract and PlanSnapshot for durability and
  presentation, but the Runtime does not execute either as a DAG.
- The Runtime may allocate an empty Workflow identity when a session has none,
  but the Agent explicitly records whether a user turn creates, revises, or
  replaces a goal. A new message alone is not a semantic workflow boundary.
- The Runtime validates ownership and command shape, persists events and
  projections, performs idempotent actions explicitly requested by the Agent,
  restores declared waits, and reports facts such as user decisions and external
  task completion.
- The Runtime never decides that a task needs a child Agent, never creates one on
  the Agent's behalf, never unlocks the “next stage,” and never changes the plan
  after a failure.
- A Workflow stays active while logical AgentTasks wait for users, other Agents,
  or external generation tasks. A single native AgentInvocation is monotonic and
  may finish while its AgentTask waits; neither terminal state implies that the
  Workflow is terminal.
- Goal/Plan changes, logical Task outcomes, and Workflow completion are root-only
  semantic writes. Verified caller identity permits direct application only for
  create/revise Goal, Plan, and child-Task outcomes. `record_goal(replace)`,
  `complete_goal`, and the root Task outcome always record immutable proposals,
  even for a verified root, so scope/root terminal state can commit atomically
  with the durable final answer. If caller identity is not proven, every
  root-only semantic action records a proposal. A strict top-level root-final
  envelope, bound to the Workflow, proposal snapshot, root run/invocation,
  per-proposal expected revisions, and a one-time challenge, commits them. The
  Runtime must not treat user-supplied role/task/thread IDs or arbitrary trailing
  JSON as caller credentials.
- Whenever proposals exist, root-final authority is durably sealed before the
  separate finalization prompt: the root Invocation moves
  `pending -> finalizing`, stores a one-time seal-token hash and
  proposal-snapshot hash, and rejects all later proposals. Only the runner
  holding that seal and the matching persistent root-run/session lease can
  commit or reject. Recovery may reject a stale finalizing Invocation only after
  that lease is absent or expired and the finalization timeout has elapsed; an
  active slow capture is not stale. A second runner cannot reuse the seal or
  commit a different snapshot.
- Both strict commit and the zero-proposal ordinary path atomically persist a
  stable database root-final delivery outbox and root-completed projection with
  the semantic result. The outbox contains an ordered event bundle with stable
  IDs for the assistant final message followed by the root-run completion
  event. Its phase is `pending | journaled | published | failed`; publisher
  leases and fence tokens are orthogonal to that phase. The database transaction
  never writes the filesystem chat log.
- The root-final publisher is the only path that projects that bundle. Under the
  existing per-session chat-writer lock it flushes buffered events, repairs only
  a torn final JSONL suffix, scans stable event IDs, and appends each missing
  event once with consecutive sequences. A complete JSON object missing only a
  newline is completed; an invalid partial suffix is truncated to the last
  complete line; non-tail corruption and same-ID/different-payload collisions
  fail closed. The publisher flushes and `fsync`s the file, and syncs the
  directory when creating it, before marking the delivery `journaled`. It then
  fans out the already-persisted events without clearing their sequences or
  appending again, and finally marks the delivery `published`.
- Live SSE is at-least-once, not physically exactly-once. If fanout succeeds and
  the `published` CAS is lost to a crash, recovery may fan out the same stable
  event IDs and sequences again. The broker must preserve those sequences and
  never append again. New persisted events carry a server-computed canonical
  payload fingerprint (excluding the assigned sequence and fingerprint field),
  copied unchanged through JSONL, hydrate, and SSE. Hydrate seeds a bounded
  frontend identity cache; streaming ingest and the store dedupe by event ID plus
  sequence and fingerprint, and reject same-ID/different-payload conflicts. The
  guarantee is one JSONL append and one visible projection, not one wire frame.
- A session retains a durable final-delivery barrier until publication. Root
  starts, continuations, queued-input dispatch, and replace handoffs cannot emit
  later session activity or cross ACP while an earlier delivery is pending or
  merely journaled. Crashes before append, during a torn write, after `fsync`,
  or after live fanout recover by stable event ID and display the final answer
  once after projection dedupe. Publication corruption leaves the barrier failed/needs-attention rather
  than allowing a successor to overtake the predecessor's final answer.
- A failed root-final delivery is a session-scoped recovery issue; it never
  reopens the completed root Task. Transient I/O remains pending with backoff,
  while `failed` is reserved for integrity errors such as non-tail corruption or
  same-ID/different-payload conflicts. A project/session-scoped reconcile command
  may revalidate the same stable bundle after the underlying log is repaired and
  use a fence to return it to pending/journaled; it may never truncate middle
  history, skip the final, or change the payload. Until validation succeeds the
  barrier remains. The existing task area shows one needs-attention row and an
  optional closable Sheet; the existing new-session action is the safe escape,
  but queued inputs are not silently migrated.
- `record_goal(replace)` is a scope handoff. Its strict root-final commit
  atomically terminates the old Workflow, supersedes/discards its pending work,
  creates one deterministic successor/root Task/root Invocation/preallocated run
  plus a durable fenced handoff record, links that handoff to the predecessor's
  root-final delivery, and switches the session pointer. This guarantees one
  local successor identity, not exactly-once ACP Prompt execution.
- Handoff status is
  `pending | leased | sending | started | unknown | failed_definite | cancelled`.
  Before entering `sending`, a short fenced transaction verifies that the
  predecessor delivery is published, the session barrier is clear, the old
  persistent root-run lease is released, and the session, Task, Invocation, and
  preallocated run still match. It then acquires the successor root-run lease;
  no database lock is held across ACP.
- An expired `leased` handoff may be dispatched again. An expired `sending`
  handoff may only use a reconcile-only lease. Automatic recovery to `started`,
  or back to `pending` after an authoritative definitely-absent result, is
  allowed only when captured fixtures prove stable-message-ID lookup, duplicate
  suppression, and result replay. Unsupported or inconclusive recovery becomes
  `unknown`: Runtime does not resend, clear the current Invocation, create a
  second root, or release queued inputs. A project/session-scoped explicit
  reconcile action may repeat only the proven lookup. An explicit stop-waiting
  action CAS-cancels the local handoff, invalidates its fence, marks the
  successor root Task needs-attention, and releases the local barrier, but does
  not requeue or resend the uncertain Prompt; late remote updates become audit
  facts only. `failed_definite` is reserved for a permanent error proven not to
  have crossed the ACP boundary. The current
  Invocation remains in the old scope and ends; the successor uses its
  preallocated identity only after these publication and dispatch barriers pass.
- Image and video generation continue to use the existing generation-settings
  dialog as their only user confirmation. Runtime adds no points, credits, cost,
  balance, payment, or second-confirmation warning; a click on the existing
  generate action is the authorization persisted by the generation outbox.
- Only a root-authorized strict completion, or an explicit user cancellation,
  makes the Workflow terminal. Late invocations may append execution facts but
  cannot semantically mutate or reopen a terminal Workflow or Task.
- A normally completed Workflow cannot contain non-terminal logical Tasks. The
  main Agent records root and child Task outcomes before `complete_goal`, in the
  same ordered atomic commit when needed. Replace and explicit Workflow cancel
  may bulk-cancel remaining Tasks with an audited scope-termination reason; the
  Runtime never converts their native Invocation history into success.

The persisted Runtime model is therefore a journal and recovery mechanism, not
a scheduler.

## Consequences

### Positive

- Agent capabilities are not constrained by a server-side task taxonomy or
  dispatcher.
- Goal-specific stopping works naturally: a screenplay-only goal does not enter
  storyboard or media stages.
- Simple tasks avoid unnecessary child-Agent overhead.
- Model and prompt improvements can change planning behavior without rewriting a
  workflow engine.
- Durable decisions and external observations can resume work after a prompt or
  process ends.

### Negative

- Correct behavior depends on strong main-Agent instructions and observable
  tests, rather than a fixed server pipeline.
- Root-versus-child caller identity is adapter-dependent. Unverified root-only
  writes and all terminal/root-scope writes need a commit barrier at the
  already-verifiable top-level root result boundary (not another user
  interaction).
- Every root assistant answer is buffered until its durable final delivery is
  committed, so the first release does not provide token-by-token final-answer
  streaming. Tool and activity updates remain real time. This is the UX cost of
  making terminal semantics and the visible final answer atomic.
- A replace handoff adds an internal successor invocation and recovery case, but
  prevents one native run from holding two incompatible Workflow scopes.
- Without fixture-proven Prompt lookup, duplicate suppression, and result
  replay, a crash after `sending` intentionally leaves the successor `unknown`
  and blocks later inputs until explicit recovery or cancellation. This trades
  automatic liveness for protection against duplicate Agent execution.
- Publishing each root-final bundle incurs a file and, on first creation,
  directory synchronization before the session barrier can clear.
- A model can forget to update the recorded plan or complete the goal; recovery
  must surface this as interrupted work instead of guessing intent.
- Runtime projections are eventually consistent with native collaboration
  events and must tolerate incomplete provider data.

### Neutral

- Runtime transport retries remain allowed only when they use the same proven
  idempotency identity and cannot create a new semantic action. Reusing a local
  handoff or Invocation ID alone does not authorize retrying an ACP Prompt after
  `sending`.
- Product defaults may recommend checkpoints, but ordinary creative checkpoints
  remain Agent/user policy rather than hard-coded stage transitions.
- The rare `unknown` handoff recovery appears only as one needs-attention row in
  the existing task area and an optional closable detail Sheet; it does not add
  a permanent Agent-management surface.

## Alternatives Considered

**Fixed screenplay production pipeline**

Rejected because it conflicts with user-defined scope and dynamic replanning.

**Hybrid scheduler in which the Agent proposes and Runtime approves dispatch**

Rejected because the approval layer still constrains delegation and duplicates
semantic decisions.

**No persistence; rely entirely on one ACP prompt**

Rejected because user decisions, child work, and media generation can outlive a
prompt or server process.

## References

- `docs/plans/2026-07-17-end-to-end-agent-orchestration-design.md`
- ADR-0003, resident ACP process lifecycle
