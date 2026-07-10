# Codex Relay Model Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Discover relay-provided models and expose them in the Agent model picker without adding model selection to relay settings.

**Architecture:** Extend the relay check response with parsed OpenAI-compatible model IDs. During Agent runtime probing, append those IDs as raw ACP choices and restrict the picker to the upstream catalog; keep relay settings focused on connection configuration.

**Tech Stack:** Go, Gin, React 19, TypeScript, SWR, Vitest, Testing Library.

---

### Task 1: Parse relay models in the settings service

**Files:**

- Modify: `services/server/internal/service/settings/codex_relay.go`
- Test: `services/server/internal/service/settings/codex_relay_test.go`

1. Add a failing service test whose `/v1/models` response includes duplicate and blank IDs and expects ordered unique model IDs.
2. Run `go test ./internal/service/settings -run TestCheckCodexRelay -count=1` and confirm failure.
3. Add `Models []string` to `CodexRelayCheckResponse`, bound the check body read, and parse `data[].id` without turning malformed model JSON into a connectivity failure.
4. Re-run the targeted test and confirm success.

### Task 2: Inject discovered models into Agent runtime config

**Files:**

- Modify: `services/server/internal/service/acp/acp_runtime_config.go`
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Modify: `services/server/internal/app/wire.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`

1. Add a failing runtime-config test with stale ACP options and discovered GPT-5.6 IDs.
2. Add discovered model values to `ProcessConfig` and the ACP model filter.
3. Append chat-capable discovered IDs before applying the authoritative allowed-model filter.
4. During Codex config probing, call the relay check and populate discovered/allowed values; skip this extra lookup when a run already has a preferred model.
5. Run the ACP and app tests.

### Task 3: Keep model selection out of relay settings

**Files:**

- Modify: `apps/workspace/src/domains/settings/api/settings.ts`
- Test: `apps/workspace/src/domains/settings/components/CodexRelayPanel.test.tsx`

1. Add the `models` field to the check response type.
2. Keep the existing assertion that the relay settings panel has no model control.
3. Run the targeted settings panel test.

### Task 4: Run quality gates

1. Run `gofmt` on changed Go files.
2. Run `pnpm format:fix` only on changed frontend files if formatting checks fail.
3. Run `task check`, `task test`, and `task build` from `services/server`.
4. Run `pnpm lint`, `pnpm format`, `pnpm test -- src/domains/settings/components/CodexRelayPanel.test.tsx`, and `pnpm build` from `apps/workspace`.
5. Report all changed files and verification results without committing unless requested.
