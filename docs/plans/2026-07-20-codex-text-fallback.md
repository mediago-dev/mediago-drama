# Codex Text Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let prompt optimization and other internal text tasks use the signed-in Codex runtime when no configured generation text route is available.

**Architecture:** Add an executor-neutral text completion coordinator with generation-route and Codex backends. Extract the existing Codex app-server JSON-RPC transport from settings, run Codex completions in isolated ephemeral threads, and expose Codex as a separate executor option instead of registering a fake `KindText` route.

**Tech Stack:** Go, Gin, Codex app-server JSON-RPC, React 19, TypeScript, SWR, Vitest.

---

## Architectural decision

- Preserve configured generation text routes as the first choice.
- Use Codex only when explicitly selected or when `auto` finds no configured text route.
- Do not retry a failed paid generation request through Codex; fallback applies only to executor availability.
- Do not expose Codex as a generation catalog route because route parameters, usage accounting, credentials, and agent lifecycle have different semantics.
- Run utility Codex turns without document MCP servers or persisted agent-chat context and honor request cancellation.

### Task 1: Extract the Codex app-server transport

**Files:**
- Create: `services/server/internal/platform/codexapp/session.go`
- Create: `services/server/internal/platform/codexapp/session_test.go`
- Modify: `services/server/internal/service/settings/codex_account.go`
- Test: `services/server/internal/service/settings/codex_account_test.go`

**Steps:**

1. Write failing transport tests covering initialization, matching JSON-RPC responses, interleaved notifications, RPC errors, cancellation, and process shutdown.
2. Run `go test ./internal/platform/codexapp -run TestSession -v` from `services/server`; expect failure because the package does not exist.
3. Move the generic process/session/message implementation out of settings into `internal/platform/codexapp`, keeping account-specific sanitization in the settings service.
4. Adapt `CodexAccountManager` to use an injected `codexapp.Session` interface so existing account tests remain deterministic.
5. Run `go test ./internal/platform/codexapp ./internal/service/settings -race` and expect success.

### Task 2: Implement the Codex utility text backend

**Files:**
- Create: `services/server/internal/service/textcompletion/types.go`
- Create: `services/server/internal/service/textcompletion/codex.go`
- Create: `services/server/internal/service/textcompletion/codex_test.go`

**Steps:**

1. Add failing tests for an ephemeral `thread/start` plus `turn/start` flow, streamed agent-message deltas, final completion, authentication failure, empty output, timeout, and cancellation.
2. Run `go test ./internal/service/textcompletion -run TestCodex -v`; expect failure.
3. Define executor-neutral request/result types and a small backend interface in the consumer package.
4. Implement the Codex backend using `codexapp.Session`: start an isolated thread, start one turn, collect `item/agentMessage/delta`, stop at `turn/completed`, and interrupt on cancellation when possible.
5. Set utility-safe turn options supported by the bundled schema: read-only sandbox, no interactive approvals, and no persisted conversation reuse.
6. Run `go test ./internal/service/textcompletion -race`; expect success.

### Task 3: Add route-first executor coordination

**Files:**
- Create: `services/server/internal/service/textcompletion/service.go`
- Create: `services/server/internal/service/textcompletion/service_test.go`
- Modify: `services/server/internal/service/generation/generation_text_completion.go`
- Modify: `services/server/internal/service/generation/generation_runtime.go`
- Modify: `services/server/internal/app/wire.go`

**Steps:**

1. Write table-driven failing tests for explicit route, explicit Codex, automatic configured-route selection, automatic Codex fallback, and neither executor being available.
2. Verify the coordinator never invokes Codex after a configured route starts and fails.
3. Extract generation-route completion behind a callback/backend while preserving `GenerationService.CompleteText` compatibility.
4. Wire the bundled Codex executable and account availability into the coordinator without reading credentials directly.
5. Update Agent session-title generation to call the coordinator instead of assuming a generation route.
6. Run focused generation, text-completion, settings, and app wiring tests with `-race`.

### Task 4: Extend prompt-optimization contracts compatibly

**Files:**
- Modify: `services/server/internal/http/dto/generation.go`
- Modify: `services/server/internal/service/generation/generation_svc.go`
- Modify: `services/server/internal/service/generation/generation_runtime_prompt_optimize.go`
- Modify: `services/server/internal/service/generation/generation_runtime_text.go`
- Modify: `packages/mcp/pkg/mcp/generation_types.go`
- Modify: `services/server/internal/app/mcp/generation_convert.go`
- Tests: corresponding generation and MCP tests

**Steps:**

1. Add failing compatibility tests for legacy `routeId`, `{executor:{type:"route"}}`, `{executor:{type:"codex"}}`, and `{executor:{type:"auto"}}` requests.
2. Add a text-executor selection DTO while keeping legacy `routeId` and `model` fields readable.
3. Route both standalone optimization and optimize-and-generate through the coordinator.
4. Preserve optimization history records; store executor metadata separately from generation route metadata.
5. Return explicit unavailable/authentication/timeout errors without leaking app-server payloads.
6. Run generation and MCP package tests with race detection.

### Task 5: Surface Codex as a frontend executor option

**Files:**
- Modify: `apps/workspace/src/api/types/generation.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/usePromptOptimize.ts`
- Modify: `apps/workspace/src/domains/generation/components/PromptOptimizeControl.tsx`
- Modify: `apps/workspace/src/domains/generation/components/MediaGenerationWorkspace.tsx`
- Modify as needed: settings API hook used to read Codex account status
- Tests: corresponding hook and component tests

**Steps:**

1. Add failing tests showing that configured route options remain first, a logged-in Codex option appears, and Codex becomes the default only when no route is configured.
2. Introduce a discriminated `TextExecutorSelection` frontend type and retain legacy request serialization for route selections.
3. Merge Codex availability from the existing account-status endpoint into prompt optimization options.
4. Render `Codex · 当前登录账户` with a distinct executor identity rather than a fake model family/route.
5. Update optimize and optimize-and-generate submissions to send the selected executor.
6. Run the focused Vitest files and verify loading, unavailable, selected, cancellation, and error states.

### Task 6: Verification and hardening

**Files:**
- Modify only where verification exposes defects.

**Steps:**

1. Run `gofmt` on changed Go files.
2. Run `task -d services/server check` and `task -d services/server test`.
3. Run `go build ./...` from `services/server` if not already covered by the task.
4. Run `pnpm --dir apps/workspace lint`.
5. Run `pnpm --dir apps/workspace format`.
6. Run `pnpm --dir apps/workspace test`.
7. Run `pnpm --dir apps/workspace build`.
8. Run `git diff --check` and inspect the final diff for credentials, auth payloads, accidental generated files, and unrelated changes.
