# LibTV Login Cancellation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make abandoned LibTV browser login attempts cancellable and immediately retryable.

**Architecture:** Track the active LibTV CLI process in the settings service with an attempt ID, cancellation function, and completion signal. Cancel and await the active attempt before logout or a new login, while preserving marker persistence for naturally completed attempts.

**Tech Stack:** Go, `os/exec`, `context`, synchronization primitives, table-oriented service tests.

---

### Task 1: Add a failing recovery regression test

**Files:**
- Modify: `services/server/internal/service/settings/store_test.go`

**Step 1:** Create a fake LibTV CLI whose `login web` prints a URL and remains running until killed.

**Step 2:** Begin login, clear the provider, then begin login again.

**Step 3:** Assert both login attempts return a pending challenge and logout runs between them.

**Step 4:** Run `go test ./internal/service/settings -run TestSettingsClearLibTVPendingLoginCancelsProcessAndAllowsRetry -count=1` and verify failure.

### Task 2: Track and cancel active login processes

**Files:**
- Modify: `services/server/internal/service/settings/store.go`

**Step 1:** Add a mutex, monotonic attempt ID, and active-process map to `Settings`.

**Step 2:** Register the LibTV process immediately after start and unregister only the matching attempt after `Wait` returns.

**Step 3:** Add a bounded helper that cancels and waits for active process completion.

**Step 4:** Cancel before `BeginLibTVLogin` starts a retry and before `ClearAPIKey` runs LibTV logout.

### Task 3: Verify behavior and quality gates

**Files:**
- Verify: `services/server/internal/service/settings/store.go`
- Verify: `services/server/internal/service/settings/store_test.go`

**Step 1:** Run focused cancellation and existing LibTV login tests.

**Step 2:** Run `gofmt`, `task check`, `task test`, and `go build ./...` from `services/server`.

**Step 3:** Confirm `git diff --check` exits successfully.
