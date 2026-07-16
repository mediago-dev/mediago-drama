# ADR-0002: Deliver Agent Instructions Through Native Runtime Configuration

## Status

Accepted

## Context

MediaGo Drama currently concatenates its fixed Agent instructions, Skill index,
and the current user request into one ACP `session/prompt` text block. ACP v1
defines that block as a user message and has no portable system/developer role.
The current implementation therefore sends roughly the same large prefix on
every turn, gives it the wrong protocol role, and leaves custom backends as the
only reason the prefix cannot simply be removed.

The bundled backends already expose native instruction mechanisms:

- Codex ACP merges `CODEX_CONFIG` into each Codex session configuration and
  accepts `developer_instructions`.
- OpenCode loads instruction files listed by `opencode.json.instructions`.

The runner currently starts a fresh ACP process for every run. Moving process
lifecycle and instruction delivery at the same time would also change
cancellation, callback routing, configuration isolation, and failure recovery.

## Decision

Render the fixed MediaGo instructions once before starting an ACP process and
pass them to the process configuration provider.

- Codex receives the text as `CODEX_CONFIG.developer_instructions`. Existing
  top-level `CODEX_CONFIG` fields are preserved.
- OpenCode receives an absolute path to a managed Markdown file via
  `opencode.json.instructions`. Each logical config and instruction body is
  published into its own content-addressed, immutable directory so concurrent
  launches cannot overwrite one another.
- A process configuration must explicitly report that native instructions were
  applied. Only then does `session/prompt` contain the incremental user prompt.
- Unknown/custom ACP backends retain the existing inline prefix as a compatibility
  fallback.
- `prompt.instruction_delivery` defaults to `native` and accepts `inline` as a
  rollback mode.
- Persist an instruction fingerprint with the ACP session ID for native and
  inline delivery. A changed delivery mode, backend, or instruction body creates
  a new ACP session and uses the
  existing compact recap path instead of silently resuming incompatible state.

Long-lived ACP connections are a separate decision. The first connection reuse
implementation should keep one connection per MediaGo session; cross-session
sharing requires a new callback dispatcher or disabling client filesystem
capabilities because ACP filesystem callbacks do not identify their session.

## Consequences

### Positive

- Fixed MediaGo instructions no longer appear in each bundled backend's ACP user
  message.
- The backend receives instructions in its intended developer/system layer.
- Custom ACP commands continue to work without claiming unsupported capability.
- Rollback and instruction changes do not reuse incompatible ACP sessions.
- Codex configuration fields and OpenCode model profiles remain composable with
  the managed instructions.

### Negative

- The fixed instructions still consume model context; this change primarily
  fixes role semantics and repeated ACP payload construction.
- Backend-specific configuration code is required for each supported Agent.
- One post-upgrade turn per existing conversation creates a new ACP session and
  includes a compact recap.
- Content-addressed OpenCode configs are retained while a process may still be
  using them; obsolete variants need a future age-based cleanup policy.

### Neutral

- OpenCode continues merging global/project configuration and discovering project
  `AGENTS.md`; this decision does not create a fully isolated OpenCode runtime.
- Managed OpenCode directories/files use `0700`/`0600` on POSIX. Windows relies
  on the workspace directory's inherited ACL because Go does not expose those
  POSIX ownership bits there.
- ACP process lifecycle is decided independently by ADR-0003; native instruction
  delivery remains valid for both short-lived and resident processes.

## Alternatives Considered

**Continue prefixing every user prompt**

Rejected as the default because it repeats a large payload and gives fixed rules
user-message semantics. Retained only as the compatibility and rollback path.

**Send instructions in `session/new._meta`**

Rejected because ACP does not define persistence or system-role semantics for
that payload, and the bundled Codex/OpenCode adapters do not advertise such a
capability.

**Replace each backend's complete base system prompt**

Rejected because it would discard built-in safety, tool, and runtime behavior.
MediaGo instructions are additive developer/project instructions.

**Implement long-lived ACP connections in the same change**

Deferred because the current `acpClient`, cancellation context, raw logger, and
filesystem callbacks are scoped to a single run. Combining both migrations would
make regressions difficult to isolate. The follow-up design was later adopted in
ADR-0003.

## References

- [ACP Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP Extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)
- [Codex ACP runtime options](https://github.com/agentclientprotocol/codex-acp#runtime-options)
- [OpenCode rules](https://opencode.ai/docs/rules/)
