# Imported Prompt Pack Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make imported prompt packs opaque and non-editable while preserving list visibility, enable/disable, runtime use, and uninstall.

**Architecture:** Treat `source == "imported"` as a protected management boundary in the prompt-pack service. The list API remains unchanged, lifecycle methods `SetEnabled` and `Uninstall` remain allowed, and content/detail plus authoring operations return `ErrPackReadonly`. The React management window renders imported packs only as disabled sidebar rows and excludes them from the overview cards, so it never requests protected contents.

**Tech Stack:** Go, Gin, Gorm, React 19, TypeScript, SWR, Vitest, Testing Library.

---

### Task 1: Define the backend access contract

**Files:**
- Modify: `services/server/internal/service/promptpack/service_test.go`

**Step 1: Write the failing test**

Add a table-driven regression test that installs an imported pack and verifies that detail, export, fork, reset, scoped entry writes, and scoped category writes return `ErrPackReadonly`.

**Step 2: Verify the lifecycle exceptions**

In the same test, verify `SetEnabled` and `Uninstall` still succeed and imported entries remain available to runtime `ListEntries` while enabled.

**Step 3: Run the focused test and verify it fails**

Run: `go test ./internal/service/promptpack -run TestServiceImportedPackManagementAccess -count=1`

Expected: FAIL because imported details and authoring operations are currently allowed.

### Task 2: Enforce imported-pack management access in the service

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: `services/server/internal/service/promptpack/import_export.go`

**Step 1: Add a shared imported-pack guard**

Add a small helper that normalizes the stored source and returns `ErrPackReadonly` for imported packs.

**Step 2: Apply the guard to protected operations**

Guard pack contents, fork/export/reset, entry create/update/reset/remove, and category create/update/delete operations. Keep list/read operations used by runtime, `SetEnabled`, and `Uninstall` unchanged.

**Step 3: Run service tests**

Run: `go test ./internal/service/promptpack -count=1`

Expected: PASS.

### Task 3: Disable imported packs in the management UI

**Files:**
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`

**Step 1: Write the failing UI regression test**

Verify an imported pack appears by name in the sidebar, its row is disabled, no imported overview card is rendered, clicking cannot select it, and a direct `?packId=<imported>` URL is cleared without requesting contents.

**Step 2: Implement the imported-pack presentation**

Filter imported packs out of the card grid, render their sidebar row with native disabled semantics and muted styling, and prevent imported IDs from producing an SWR contents key. Clear stale or direct imported selections after the pack list resolves.

**Step 3: Run the focused UI test**

Run: `pnpm --dir apps/workspace test -- PromptPackEditor.test.tsx`

Expected: PASS.

### Task 4: Verify quality gates

**Files:**
- Verify all modified files.

**Step 1: Format modified files**

Run: `gofmt -w services/server/internal/service/promptpack/service.go services/server/internal/service/promptpack/import_export.go services/server/internal/service/promptpack/service_test.go`

Run: `pnpm --dir apps/workspace exec oxfmt --write src/pages/PromptPackEditor.tsx src/pages/PromptPackEditor.test.tsx src/domains/settings/components/debug/PromptPackWorkspace.tsx`

**Step 2: Run backend quality gates**

Run: `task -d services/server check`

Run: `task -d services/server test`

Expected: PASS.

**Step 3: Run frontend quality gates**

Run: `pnpm --dir apps/workspace lint`

Run: `pnpm --dir apps/workspace format`

Run: `pnpm --dir apps/workspace build`

Expected: PASS.
