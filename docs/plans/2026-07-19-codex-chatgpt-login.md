# Codex ChatGPT Official Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a browser-based ChatGPT subscription login channel for the bundled Codex runtime while reusing the user's global Codex authentication state.

**Architecture:** A Go `CodexAccountManager` runs the bundled Codex app-server over stdio and exposes redacted account/login operations through settings HTTP endpoints. Official mode inherits the global `CODEX_HOME`; the existing relay mode continues to inject its isolated home, and the React settings UI lets users select and manage either channel.

**Tech Stack:** Go, Gin, Codex app-server JSON-RPC, React 19, TypeScript, SWR, Vitest, Electron external-link IPC.

---

### Task 1: Expose the bundled Codex executable

**Files:**
- Modify: `services/server/internal/service/agent/agent_backends.go`
- Test: `services/server/internal/service/agent/agent_backends_test.go`

**Steps:**

1. Add a failing table-driven test for a `CodexExecutable()` method that resolves `codexBin` only for the bundled Codex backend and rejects traversal or missing manifests.
2. Run `go test ./internal/service/agent -run TestAgentBackendServiceCodexExecutable -v` and verify failure.
3. Implement the method using the existing manifest resolution and safe path checks.
4. Run the focused test and `go test ./internal/service/agent -race`.
5. Commit with `feat(codex): expose bundled executable path`.

### Task 2: Implement the app-server JSON-RPC account client

**Files:**
- Create: `services/server/internal/service/settings/codex_account.go`
- Create: `services/server/internal/service/settings/codex_account_test.go`
- Modify: `services/server/internal/service/settings/store.go`

**Steps:**

1. Write a fake executable fixture in the test that speaks newline-delimited app-server JSON-RPC and supports `initialize`, `account/read`, `account/login/start`, `account/login/cancel`, and `account/logout`.
2. Add failing tests for global `CODEX_HOME` resolution, redacted account reads, browser login response, completion notification, cancellation, duplicate login reuse, timeout cleanup, and subprocess failure.
3. Run `go test ./internal/service/settings -run 'TestCodexAccount' -v` and verify failure.
4. Implement `CodexAccountManager` with an injectable command factory/clock for deterministic tests, a single pending login guarded by a mutex, and a 10-minute timeout.
5. Ensure public error messages never include OAuth query strings or credential payloads.
6. Run focused tests and `go test ./internal/service/settings -race`.
7. Commit with `feat(codex): add ChatGPT account manager`.

### Task 3: Add settings HTTP endpoints

**Files:**
- Modify: `services/server/internal/http/handlers/settings.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `services/server/internal/app/server_test.go`
- Test: `services/server/internal/http/handlers/settings_test.go` or the existing settings handler test file

**Steps:**

1. Add failing handler tests for account read, login start/status/cancel, logout, missing login IDs, and unavailable bundled Codex.
2. Run focused handler tests and confirm failure.
3. Inject the bundled Codex path into settings during app wiring.
4. Add the five `/settings/codex-account` routes and Swagger annotations.
5. Map invalid input to 400, unknown login to 404, conflict to 409, and process failures to safe 500/503 responses.
6. Run handler tests, `go test ./internal/app -race`, and Swagger generation.
7. Commit with `feat(settings): expose Codex account login API`.

### Task 4: Preserve global official auth in runtime configuration

**Files:**
- Modify: `services/server/internal/service/settings/codex_relay.go`
- Modify: `services/server/internal/app/wire.go`
- Test: `services/server/internal/service/settings/codex_relay_test.go`
- Test: `services/server/internal/app/wire_test.go`

**Steps:**

1. Add failing tests showing relay-disabled Codex runs inherit global `CODEX_HOME` unchanged and relay-enabled runs use the isolated relay home.
2. Run the focused tests and confirm failure where current behavior is ambiguous.
3. Refactor runtime preparation into a channel-aware method without writing to the global Codex directory.
4. Keep the relay-generated `config.toml` and local auth marker isolated under `.mediago/codex-relay`.
5. Run focused tests and all settings/app tests with race detection.
6. Commit with `refactor(codex): isolate relay from global auth`.

### Task 5: Add frontend account API and Codex access panel

**Files:**
- Modify: `apps/workspace/src/domains/settings/api/settings.ts`
- Create: `apps/workspace/src/domains/settings/components/CodexAccessPanel.tsx`
- Create: `apps/workspace/src/domains/settings/components/CodexAccessPanel.test.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.tsx`

**Steps:**

1. Add API types and functions for account read, login start/status/cancel, and logout.
2. Write failing component tests for existing login reuse, external browser opening, polling completion, retry open, cancel, shared logout warning, and channel selection.
3. Run `pnpm test -- CodexAccessPanel.test.tsx` and verify failure.
4. Implement the panel using SWR, existing semantic design tokens, `openExternalUrl`, `useToast`, and `confirmDialog`.
5. Extract a controlled relay-enabled callback from `CodexRelayPanel` only as needed; do not duplicate relay settings logic.
6. Run the focused test, frontend lint, and formatter.
7. Commit with `feat(workspace): add Codex official login channel`.

### Task 6: Wire settings navigation and runtime recovery

**Files:**
- Modify: `apps/workspace/src/pages/Settings.tsx`
- Modify: `apps/workspace/src/pages/Settings.test.tsx`
- Modify: `apps/workspace/src/domains/workspace/components/ProjectNavigatorPanels.tsx`
- Modify: `apps/workspace/src/domains/workspace/components/ProjectNavigatorPanels.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`

**Steps:**

1. Update failing tests to expect the `codex-access` tab and “Codex 接入” label.
2. Run the three focused test files and verify failure.
3. Render `CodexAccessPanel` for the new tab and redirect the legacy `codex-relay` query value to it for backward compatibility.
4. Route Codex runtime authentication errors to the unified access panel.
5. Run all affected component tests.
6. Commit with `feat(workspace): unify Codex access settings`.

### Task 7: Full verification and documentation sync

**Files:**
- Modify if generated output requires it: `.cache/server-swagger/swagger.json`
- Modify if user-facing documentation requires it: `README.md`

**Steps:**

1. Run `task -d services/server fmt`.
2. Run `task -d services/server check`; expect all Go formatting, vet, lint, build, race tests, and Swagger checks to pass.
3. Run `pnpm --dir apps/workspace lint`.
4. Run `pnpm --dir apps/workspace format`.
5. Run `pnpm --dir apps/workspace test`.
6. Run `pnpm --dir apps/workspace build`.
7. Review `git diff --check`, confirm no secrets or OAuth URLs were committed, and explicitly stage only feature files.
8. Commit with `test(codex): verify official login integration` if verification produces tracked updates; otherwise record the clean verification result in the handoff.
