# Agent Runtime Authentication Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make an unauthenticated or unavailable Agent runtime visible and recoverable instead of silently hiding the model picker.

**Architecture:** Preserve ACP typed errors through the service boundary, map probe failures to safe HTTP errors, and render a compact recovery state in the Agent composer. Runtime settings mutations invalidate the probe cache so configured models appear without restarting the app.

**Tech Stack:** Go 1.25, Gin, ACP Go SDK, React 19, TypeScript, SWR, Vitest.

---

### Task 1: Pin the backend error contract

**Files:**
- Create: `services/server/internal/service/acp/acp_errors_test.go`
- Create: `services/server/internal/http/handlers/agent_runtime_test.go`
- Modify: `services/server/internal/http/handlers/agent_runtime.go`
- Modify: `services/server/internal/app/app.go`

**Steps:**
1. Add failing table tests proving only typed ACP code `-32000` is authentication-required.
2. Add failing handler tests for success, auth-required `503`, generic `503`, nil inspector, and internal-detail redaction.
3. Run the targeted Go tests and confirm the new expectations fail.
4. Add the ACP predicate and replace silent `200 {}` branches with safe error responses.
5. Run the targeted Go tests and confirm they pass.

### Task 2: Render and recover from runtime probe errors

**Files:**
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentRuntimeConfigControls.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentRuntimeConfigControls.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentChatComposerForm.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`

**Steps:**
1. Add failing component tests for plain-object error messages, the compact error state, recovery callbacks, and preserving stale options.
2. Add a failing AgentChat routing test that expects Codex errors to open `/settings` with the `codex-relay` tab selected.
3. Run the targeted Vitest files and confirm the failures.
4. Implement safe error extraction, explicit retry, settings navigation, and disabled automatic SWR retries.
5. Run the targeted Vitest files and confirm they pass.

### Task 3: Refresh runtime configuration after settings changes

**Files:**
- Modify: `apps/workspace/src/domains/agent/api/agent.ts`
- Modify: `apps/workspace/src/pages/Settings.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.test.tsx`

**Steps:**
1. Add a failing Relay panel test expecting successful credential/config changes to invalidate `*/agent/runtime-config`.
2. Export the existing runtime key predicate from the Agent API and reuse it in both settings surfaces.
3. Invalidate the runtime probe whenever relay state was persisted, including later check or rollback failures, plus successful clear or delete operations.
4. Run the settings tests and confirm they pass.

### Task 4: Verify the full change

**Files:**
- Verify all modified files.

**Steps:**
1. Run targeted Go and Vitest regression suites.
2. Run `pnpm lint`, `pnpm format`, and `pnpm build` in `apps/workspace`.
3. Run `task check`, `task test`, and `task build` in `services/server`.
4. Inspect the rendered desktop and narrow-width error states if the local app can be started.
5. Review `git diff` and `git status` to ensure only scoped files changed.
