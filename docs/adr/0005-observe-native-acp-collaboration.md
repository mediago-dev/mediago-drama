# ADR-0005: Observe Native ACP Collaboration Instead of Replacing It

## Status

Accepted

## Context

The main Agent must be able to use Codex child Agents without MediaGo limiting
their capabilities. A supplied planning document proposes concrete legacy tool
names and fields such as `spawnAgent`, `receiverThreadIds`, and
`_meta.codex.toolName`. The repository currently pins `codex-acp 1.1.2` and
Codex `0.144.0`, but it contains no captured collaboration fixture proving that
those exact fields are emitted.

The ACP SDK can carry standard tool-call fields, raw input/output, and `_meta`.
MediaGo currently drops some metadata. The runner also does not expose a proven
way to list or directly resume child threads, and session replay outside an
active prompt is not currently retained.

Replacing native collaboration with a MediaGo dispatcher would provide cleaner
events, but it would create a second, less capable Agent model and make the
Runtime the owner of delegation.

## Decision

Keep Codex/ACP native collaboration as the execution mechanism and add a
read-only compatibility layer in MediaGo.

- MediaGo never implements or proxies native spawn, wait, send, resume, or close
  semantics.
- Before creating internal child AgentTask/AgentInvocation projections, capture
  sanitized raw JSON-RPC fixtures from the pinned adapter for parallel spawn,
  wait, follow-up, resume, close, success, failure, cancellation, and parent
  completion.
- The fixture contract records orthogonal parent-boundary evidence:
  `activeChildAfterParent=cancelled|continues|unobservable`, live late-update
  support, cross-process child replay support, and finalization-source
  correlation. Unobserved capability is never treated as support; live updates
  do not imply restart replay.
- The fixture contract separately records root-Prompt dispatch evidence:
  request `messageId` echo, lookup by that ID, an authoritative
  definitely-absent result, duplicate-message suppression, and result replay.
  The ACP field is correlation only until the pinned adapter demonstrates those
  behaviors under crash/reconnect fixtures. Session list/load capability or an
  echoed ID alone is not proof of idempotency or recovery.
- Include a side-effect-free root/child `workflow_whoami` probe in the fixture
  gate. Tool-supplied task/thread IDs are not authentication; root-only Runtime
  actions may be enforced directly only when the adapter supplies a verified
  caller identity, and then only for create/revise Goal, Plan, and child-Task
  outcomes. Replace, complete, and the root Task outcome always become proposals
  so terminal state and the durable root answer commit together. When identity
  is unverified, every root-only semantic action becomes a proposal. Proposals
  can be committed only by the strict top-level root-final envelope.
- Preserve the standard ACP payload, raw input/output, tool-level metadata, and
  notification-level metadata.
- Normalize only field combinations proven by fixtures. Unknown or ambiguous
  events remain ordinary ACP tool events.
- When a child continues and late updates are proven, the resident runner keeps
  a read-only event sink until terminal. Cross-process recovery uses only a
  separately proven replay/reconnect path. Otherwise the main Agent must
  wait/close known children before a strict final boundary, and residual child
  work becomes interrupted/needs-attention rather than permanently running.
- A replace handoff uses deterministic local Workflow, Task, Invocation, run,
  and stable Prompt-message identities, but does not claim that ACP executes the
  Prompt exactly once. Its durable states are
  `pending | leased | sending | started | unknown | failed_definite | cancelled`.
  `leased` may be reclaimed for dispatch; `sending` may only be reclaimed in
  reconcile-only mode. A fixture-proven lookup may recover a matching Prompt,
  and only an authoritative definitely-absent result permits dispatching the
  same frozen request again. Unsupported, missing, or ambiguous evidence becomes
  `unknown` and blocks automatic resend, replacement Invocation creation, and
  queued-input dispatch. Explicit reconcile repeats lookup only. Explicitly
  stopping the wait cancels the local barrier without automatically requeueing
  or resending the uncertain Prompt; a later attempt must come from a new,
  deliberate user/main-Agent instruction.
- Handoff dispatch cannot enter `sending` until the predecessor's durable
  root-final event bundle is `published`, its session final-delivery barrier is
  clear, and the old persistent root-run lease is released. The final fenced
  transaction also verifies the active Workflow, successor Task/Invocation/run,
  target ACP session, Prompt fingerprint, and worker lease before acquiring the
  successor root-run lease. Database locks are released before the native ACP
  call.
- Once `sending` is durable, the Prompt, instructions, handoff summary, target
  ACP session, and all identities are frozen. The resident runner's existing
  empty-response path must not create a new session and repeat a handoff Prompt.
  `failed_definite` is allowed only for an error proven not to have crossed ACP;
  every unsupported or inconclusive post-send outcome fails closed to
  `unknown`/needs-attention.
- If correlation is insufficient, use `ordinary_tool_only`: retain ordinary ACP
  tool/activity rendering, but create no inferred child Task, capsule, or detail
  Sheet. Decision queues remain available independently.
- Use one version-tolerant normalizer as the boundary between provider-specific
  payloads and internal `agent.subagent.*` events.
- Treat child-thread listing, loading, result extraction, and direct resume as
  optional capabilities. Add them only after fixtures prove adapter support and
  replay behavior.
- The reliable first continuation path is main-Agent relay: a decision or
  external result resumes the main Agent, which uses its native collaboration
  tools to continue, redirect, or replace child work.
- Do not modify or fork the vendored adapter in the first phase. If fixtures
  prove that required data is discarded and no standard ACP path exists, record
  a separate upgrade/fork decision.

## Consequences

### Positive

- The main Agent retains the full native collaboration surface and future Codex
  improvements.
- MediaGo's UI receives stable provider-neutral task and invocation shapes when
  evidence is sufficient.
- Fixture-gated parsing prevents fabricated child states and makes adapter
  upgrades testable.
- An unsupported provider still works through ordinary ACP tool rendering.

### Negative

- Rich child detail may be unavailable until the adapter exposes it.
- Main-Agent relay can add one continuation hop compared with direct child
  resume.
- Captured fixture maintenance becomes part of adapter version upgrades.
- Adapters without proven root-Prompt lookup, duplicate suppression, and result
  replay can leave a replace successor in `unknown` after a crash. This is an
  intentional at-most-once-send boundary, not a Runtime retry failure.

### Neutral

- A child thread and a logical child run are not assumed to be one-to-one. A
  future verified resume may produce another run for the same thread.
- Session list/load APIs are not accepted as evidence merely because they exist
  in the SDK; the pinned adapter must advertise and demonstrate them.

## Alternatives Considered

**Build a MediaGo child-Agent dispatcher**

Rejected because it transfers semantic control from the Agent to the Runtime and
can only approximate native behavior.

**Parse proposed legacy fields without fixtures**

Rejected because no repository evidence establishes those fields as a stable
contract.

**Patch `codex-acp` immediately**

Rejected until a captured protocol gap proves that an upstream or local adapter
change is necessary.

## References

- `docs/plans/2026-07-17-end-to-end-agent-orchestration-design.md`
- `packages/vendor/agents.json`
- `services/server/internal/service/acp/acp_client_updates.go`
