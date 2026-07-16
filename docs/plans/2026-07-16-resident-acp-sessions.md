# Resident ACP Sessions Implementation Plan

**Goal:** Reuse one initialized ACP process per MediaGo session while preserving
session isolation and deterministic recovery.

**Architecture:** A runner-owned registry leases a session-local resident
process. A versioned launch fingerprint determines reuse, run-scoped callback
state is rebound under the lease, and any unsuccessful run invalidates the
process. Idle timers and runtime shutdown close retained processes.

**Tech Stack:** Go, ACP Go SDK, `os/exec`, synchronized in-memory registry.

---

### Task 1: Define connection and process lifecycle seams

**Files:**
- Add: `services/server/internal/service/acp/acp_runner_resident.go`
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Test: `services/server/internal/service/acp/acp_runner_resident_test.go`

1. Add a narrow ACP connection interface and injectable resident-process factory.
2. Add an idempotent process handle carrying the initialization response,
   process fingerprint, and callback router.
3. Add deterministic process fingerprint tests covering stable input and changed
   command, environment, directory, and instructions while excluding run-scoped
   MCP definitions.
4. Run the focused fingerprint and lifecycle tests.

### Task 2: Add the per-session registry and eviction

**Files:**
- Modify: `services/server/internal/service/acp/acp_runner_resident.go`
- Test: `services/server/internal/service/acp/acp_runner_resident_test.go`

1. Write tests for same-session serialization, cross-session independence, idle
   eviction, replacement safety, and idempotent close.
2. Implement acquire/release leases, timer scheduling, exact-instance
   invalidation, disconnect watching, and runner shutdown.
3. Run the focused lifecycle tests with `-race`.

### Task 3: Make ACP callbacks safely rebindable

**Files:**
- Add: `services/server/internal/service/acp/acp_client_router.go`
- Modify: `services/server/internal/service/acp/acp_runner_process.go`
- Test: existing ACP client tests plus resident tests.

1. Add a synchronized process-scoped callback router that binds a fresh
   run-scoped `acpClient` for each turn.
2. Route filesystem callbacks, permissions, session updates, stdout, and stderr
   through the current client and drop late output after unbind.
3. Preserve the existing `acpClient` construction and its small unit tests.
4. Run ACP client and process logger tests with `-race`.

### Task 4: Reuse the process and active ACP session in `Run`

**Files:**
- Modify: `services/server/internal/service/acp/acp_runner_run.go`
- Test: `services/server/internal/service/acp/acp_runner_resident_test.go`

1. Write a fake-connection test proving two successful turns launch once,
   initialize once, create one ACP session, resume it with the second run's MCP
   definitions, and prompt twice.
2. Move process preparation and MCP resolution before lease acquisition.
3. Reuse a matching process; replace it on fingerprint mismatch.
4. Re-run resume/load for every persisted ACP session so `RunID`, active document,
   selection, and Agent tag in the MCP attachment are refreshed each turn.
5. Retain the process only on successful completion; invalidate it for all error
   and cancellation paths.
6. Test configuration replacement, separate sessions, failure recovery, and
   idle cleanup.

### Task 5: Integrate runtime shutdown

**Files:**
- Modify: `services/server/internal/service/agent/agent_runtime.go`
- Test: `services/server/internal/service/agent/agent_runtime_test.go`

1. Define an optional runner close contract.
2. Test that close cancels active work, closes the runner before waiting so a
   stuck transport can exit, and that concurrent calls close it once.
3. Invoke the optional close before the lifecycle group drains.

### Task 6: Verify the complete change

1. Format every modified Go file with `gofmt`.
2. Run focused ACP and Agent tests with `-race`.
3. Run all server package tests that do not require forbidden sandbox listeners.
4. Run compile-only coverage, `go vet`, `go build`, and lint.
5. Review the diff for leaked environment values, callback cross-talk, timer
   leaks, goroutine leaks, unintended files, and prompt behavior regressions.
