# Local MCP Proxy and Packaging Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep MediaGo Drama's local MCP HTTP bridge out of system proxies and ship the stdio MCP fallback binaries in desktop builds.

**Architecture:** Extend the ACP child-process environment merge so loopback hosts are always appended to both uppercase and lowercase no-proxy variables without discarding user entries. Extend Electron resource staging to validate and copy the server, document MCP, and generation MCP sibling binaries as one required set.

**Tech Stack:** Go, TypeScript/Node.js, Electron Builder, Go standard testing.

---

### Task 1: Protect loopback traffic from proxies

**Files:**
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`

1. Add failing table-driven tests covering empty, existing, uppercase, and lowercase no-proxy values.
2. Run the focused Go tests and confirm failure.
3. Add a helper that appends `127.0.0.1`, `localhost`, and `::1` to `NO_PROXY` and `no_proxy` in the ACP child environment.
4. Run the focused tests and confirm they pass.

### Task 2: Stage MCP fallback binaries

**Files:**
- Modify: `apps/workspace/scripts/stage-electron.ts`

1. Resolve all three target-specific binary paths from the same build output directory.
2. Validate each binary before deleting or rebuilding the staged resources directory.
3. Copy each binary to `electron/resources/bin` and preserve executable permissions.
4. Run TypeScript compilation, lint, and formatting checks.

### Task 3: Verify the integrated fix

1. Run the ACP service package tests.
2. Run the server quality gates appropriate to the touched Go package.
3. Run workspace lint, format, and build checks.
4. Inspect the diff and report any unrelated pre-existing failures separately.
