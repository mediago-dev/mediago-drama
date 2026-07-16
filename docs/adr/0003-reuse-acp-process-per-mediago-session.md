# ADR-0003: Reuse One ACP Process per MediaGo Session

## Status

Accepted

## Context

ADR-0002 moved MediaGo Drama's fixed instructions out of each ACP user prompt and
into backend-native process configuration. The ACP runner still starts,
initializes, and kills a child process for every user turn. That preserves
correctness, but repeats process startup, adapter initialization, provider
configuration loading, and ACP session resume/load work on every message.

ACP client callbacks such as filesystem access and permission requests are
delivered through the client object attached to a connection. Filesystem
callbacks do not carry a MediaGo session identifier, while run events, raw logs,
and permission requests are scoped to one active MediaGo run. Sharing one
connection across unrelated sessions would therefore require a separate,
verified callback dispatcher.

Cancellation also changes when a process survives a prompt. With a per-turn
process, cancelling the run context implicitly kills the child. A resident
process must not be reused until a cancelled or failed prompt is known to have
stopped.

## Decision

Keep at most one resident ACP process and connection for each MediaGo session.

- Runs for the same MediaGo session are serialized by a per-session lease.
- Runs for different sessions may proceed concurrently and never share an ACP
  client callback endpoint.
- A successful next turn reuses the live ACP process and connection, but it still
  issues `session/resume` (or `session/load`) for the persisted ACP session before
  prompting. MediaGo's MCP URL/environment contains the current run ID, active
  document, and selection, so every turn must reconnect the session to that
  turn's MCP definitions.
- Before each run, recompute a process fingerprint over the command, arguments,
  working directory, effective environment, and native instruction identity. A
  mismatch closes the old process and starts a new one. Run-scoped MCP definitions
  are deliberately excluded from this launch fingerprint and are supplied by the
  per-turn resume/load request instead.
- When a new process replaces an old one, use the persisted ACP session ID with
  `session/resume` or `session/load` when supported; otherwise create a new ACP
  session and inject the existing compact transcript recap.
- Any prompt, configuration, or protocol error invalidates and closes that
  resident process. In particular, a cancelled prompt is never followed by reuse
  of the same connection.
- Rebind run-scoped publishing, raw logging, IDs, message buffers, and permission
  state only while the session lease is held. Process stdout/stderr is routed to
  the current binding and is not published to a completed run.
- If resume/load fails, the runner creates a new ACP session on the same healthy
  connection and injects the existing compact recap. It never silently prompts
  with a stale MCP attachment.
- Successful idle connections are evicted after a bounded idle timeout. Runtime
  shutdown cancels active runs first, closes every resident process so blocked
  transports can exit, and only then waits for run goroutines. Close is
  idempotent.
- `InspectSessionConfig` remains an isolated, short-lived probe so opening a
  settings screen cannot create or replace a conversation's resident process.

The initial implementation uses an internal default idle timeout with a test
override. Operational configuration is deferred until there is evidence that
the default needs tuning.

## Consequences

### Positive

- Consecutive turns avoid child-process startup and ACP initialization. They keep
  the protocol-level resume/load call needed to refresh run-scoped MCP context.
- Fixed native process configuration is transported only when a process is first
  created or its fingerprint changes.
- Session-local callbacks, permission prompts, logs, and filesystem scope remain
  isolated.
- Cancellation and protocol failures recover through a clean process on the next
  turn instead of risking use of an ambiguous connection.
- Idle eviction and runtime shutdown bound process and descriptor lifetime.

### Negative

- The runner now owns a concurrent process registry, leases, timers, and explicit
  shutdown behavior.
- A successful conversation may keep one adapter process alive while idle.
- Any run error takes the conservative recovery path and forfeits an otherwise
  potentially healthy process.
- Process configuration is still prepared locally before each turn so changes
  can be detected, even though it is not retransmitted to an unchanged child.

### Neutral

- ACP session IDs and instruction fingerprints remain persisted exactly as
  before; the resident process is an in-memory acceleration, not durable state.
- A server restart loses resident processes and resumes persisted ACP sessions on
  demand.
- Multiple MediaGo sessions may still refer to backend-side ACP sessions, but
  they never share one live client connection in this design.

## Alternatives Considered

**One global ACP process for all MediaGo sessions**

Rejected because callback requests do not consistently identify the target
MediaGo session. It also increases failure blast radius and requires multiplexed
run-state routing.

**A generic pool of interchangeable ACP processes**

Rejected because an ACP connection carries session state, MCP attachment, native
configuration, and callback identity. Pooling would add reassignment complexity
without improving the common consecutive-turn path.

**Keep one process per turn**

Retained only as the failure recovery behavior. It is simpler but leaves the
avoidable startup and initialization cost on every user message.

**Keep a failed or cancelled connection and probe its health**

Rejected for the first implementation. ACP cancellation is asynchronous from the
runner's perspective, so killing and recreating is the deterministic boundary.

## References

- [ACP session setup, resume, close, and MCP attachment](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation)
- [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp)
- [OpenCode ACP implementation](https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/acp)
