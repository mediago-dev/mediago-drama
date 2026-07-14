# Jimeng Login Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make interrupted Jimeng OAuth login recoverable without leaving a long-running CLI process or a disabled settings row.

**Architecture:** Start Jimeng OAuth with the CLI's headless device-flow command so the server receives and returns the verification URI, user code, and device code after a short-lived process exits. Keep login completion in the existing `/login/check` endpoint, and let the settings UI clear a pending challenge through the existing credential-clear action.

**Tech Stack:** Go, Gin service layer, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Cover the headless Jimeng login contract

**Files:**
- Modify: `services/server/internal/service/settings/store_test.go`
- Modify: `services/server/internal/service/settings/store.go`

**Step 1: Write the failing test**

Update the fake Jimeng CLI to accept exactly `login --headless`, emit all device-flow fields, and exit immediately. Assert that `BeginJimengLogin` returns `pending`, preserves `deviceCode`, and does not store an OAuth marker before confirmation.

**Step 2: Run test to verify it fails**

Run: `go test ./internal/service/settings -run TestSettingsJimengHeadlessLoginReturnsChallenge -count=1`

Expected: FAIL because the service still invokes the blocking `dreamina login` command and hides the device code.

**Step 3: Write minimal implementation**

Replace the long-running Jimeng process watcher with `runJimengCommand(..., "login", "--headless")`. Parse the completed command output, require a pending challenge containing verification URI, user code, and device code, clear any stale marker, and return the challenge without a persistence goroutine.

**Step 4: Run test to verify it passes**

Run: `go test ./internal/service/settings -run 'TestSettings(JimengHeadlessLoginReturnsChallenge|BeginJimengLoginStoresOAuthMarkerWhenSessionExists)' -count=1`

Expected: PASS.

### Task 2: Make a pending UI challenge clearable

**Files:**
- Modify: `apps/workspace/src/pages/Settings.test.tsx`
- Modify: `apps/workspace/src/pages/Settings.tsx`

**Step 1: Write the failing test**

Start a pending Jimeng login with a device code, assert that the confirmation control is enabled, click the clear credential action, and assert that the pending state is removed and the normal login action becomes available again.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/workspace test -- src/pages/Settings.test.tsx`

Expected: FAIL because the clear action is disabled for an unconfigured provider and successful clearing does not remove the local challenge.

**Step 3: Write minimal implementation**

Treat a pending OAuth challenge as clearable. After the clear API succeeds, remove that provider's login challenge from local state so the user can immediately start a new login.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/workspace test -- src/pages/Settings.test.tsx`

Expected: PASS.

### Task 3: Run quality gates

**Files:**
- Verify: `services/server/internal/service/settings/store.go`
- Verify: `services/server/internal/service/settings/store_test.go`
- Verify: `apps/workspace/src/pages/Settings.tsx`
- Verify: `apps/workspace/src/pages/Settings.test.tsx`

**Step 1: Format changed files**

Run: `gofmt -w services/server/internal/service/settings/store.go services/server/internal/service/settings/store_test.go`

Run: `pnpm --dir apps/workspace exec oxfmt --write src/pages/Settings.tsx src/pages/Settings.test.tsx`

**Step 2: Run focused and package tests**

Run: `go test -race ./internal/service/settings/...` from `services/server`.

Run: `pnpm test -- src/pages/Settings.test.tsx` from `apps/workspace`.

**Step 3: Run project gates**

Run: `pnpm lint`, `pnpm format`, and `pnpm build` from `apps/workspace`.

Run: `task check`, `task test`, and `go build ./...` from `services/server`.

Expected: all commands exit 0.
