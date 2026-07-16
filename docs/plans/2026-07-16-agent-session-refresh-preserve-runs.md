# Agent Session Refresh Preserve Runs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent persisted session-list and latest-session reads from deleting an active in-memory agent run, so a valid generation confirmation remains submittable.

**Architecture:** Keep the process-local `SessionService` entry authoritative once it exists because run records are intentionally not persisted. Repository reads may populate a missing session, but must never replace an existing entry and its `runs` map.

**Tech Stack:** Go, Gorm-backed session repository, standard `testing` package.

---

### Task 1: Add regression coverage

**Files:**
- Modify: `services/server/internal/service/agent/agent_sessions_service_test.go`

**Step 1: Write the failing repository-read regression table**

Create a repository-backed session and start `run-1`. Cover both `List("project-1")` and `ProjectSessionID("project-1")` as table cases, then assert `WithRunStatus` still finds `run-1` with status `running`.

**Step 2: Verify the regression**

Run: `go test ./internal/service/agent -run TestSessionServiceRepositoryReadsPreserveActiveRun -count=1`

Expected: both new tests fail because repository hydration currently replaces the in-memory session with an empty `runs` map.

### Task 2: Preserve process-local run state

**Files:**
- Modify: `services/server/internal/service/agent/agent_sessions_service.go`

**Step 1: Add a cache-if-absent helper**

Add an unexported helper that loads a persisted session only when the session ID is not already present in `store.sessions`.

**Step 2: Use the helper in both read paths**

Replace unconditional assignments in `projectSessionID` and `sessionSummariesFromModelsUnlocked`. Do not weaken `WithRunStatus` or the selection service's terminal-run guard.

**Step 3: Verify the focused tests pass**

Run: `go test ./internal/service/agent -run TestSessionServiceRepositoryReadsPreserveActiveRun -count=1`

Expected: PASS.

### Task 3: Run quality gates

**Files:**
- Verify only.

**Step 1:** Run `go test ./internal/service/agent ./internal/service/selection`.

**Step 2:** Run `task check`.

**Step 3:** Run `task test`.

**Step 4:** Run `go build ./...`.

Expected: all commands exit successfully. Do not stage or commit unless explicitly requested.
