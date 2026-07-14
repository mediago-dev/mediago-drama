# Credential Row Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace persistent row-level trash buttons with an accessible ellipsis menu and confirmed credential removal.

**Architecture:** Add a reusable row action popover in `Settings.tsx` and route all clear/logout actions through the existing callable confirmation dialog. Keep the existing API request and state refresh logic unchanged, returning its success state to the dialog so failures remain retryable.

**Tech Stack:** React 19, TypeScript, Radix Popover, shared ConfirmDialog, Tailwind CSS v4, Vitest, Testing Library.

---

### Task 1: Specify menu and confirmation behavior

**Files:**
- Modify: `apps/workspace/src/pages/Settings.test.tsx`

**Step 1:** Add the shared `ConfirmDialog` host to the settings test renderer.

**Step 2:** Add a configured API-key test that opens “更多操作”, selects “清除 API Key”, verifies no request occurs before confirmation, then confirms and verifies the request.

**Step 3:** Update the pending Jimeng test to select “取消登录” from the menu and confirm before expecting its state to clear.

**Step 4:** Run `pnpm test -- src/pages/Settings.test.tsx` and verify the new assertions fail against direct trash-button behavior.

### Task 2: Implement reusable row actions

**Files:**
- Modify: `apps/workspace/src/pages/Settings.tsx`

**Step 1:** Add a `CredentialMoreMenu` component using the existing Popover and Button primitives.

**Step 2:** Replace trash buttons in OAuth and manual provider rows with the menu, placing the ellipsis last in each row.

**Step 3:** Add provider-specific labels and disabled/loading states.

**Step 4:** Run the focused settings tests and verify the menu behavior passes.

### Task 3: Confirm destructive credential actions

**Files:**
- Modify: `apps/workspace/src/pages/Settings.tsx`

**Step 1:** Make the existing clear workflow return success or failure.

**Step 2:** Add a confirmation wrapper with OAuth, pending-login, and API-key copy.

**Step 3:** Route row menus and configuration-dialog clear controls through the wrapper.

**Step 4:** Verify cancellation performs no request and confirmation performs exactly one request.

### Task 4: Quality gates and visual check

**Files:**
- Verify: `apps/workspace/src/pages/Settings.tsx`
- Verify: `apps/workspace/src/pages/Settings.test.tsx`

**Step 1:** Run `pnpm exec oxfmt --write src/pages/Settings.tsx src/pages/Settings.test.tsx`.

**Step 2:** Run `pnpm test -- src/pages/Settings.test.tsx`, `pnpm lint`, `pnpm format`, and `pnpm build`.

**Step 3:** Launch the settings page and inspect the CLI, custom, and official provider rows at desktop width.
