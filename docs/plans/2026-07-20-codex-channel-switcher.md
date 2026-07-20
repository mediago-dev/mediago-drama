# Codex Channel Switcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the split official-account and relay editor layout with one CC Switch-style channel list where the official Codex login and relay profiles are peer choices.

**Architecture:** `CodexAccessPanel` continues to own global Codex account login/logout state. `CodexRelayPanel` continues to own relay persistence and runtime invalidation, but renders the official account as the first immutable channel card and every relay profile as a peer card. Relay name, Base URL, and API Key editing move into one dialog so the primary surface remains a compact channel switcher.

**Tech Stack:** React 19, TypeScript, SWR, Radix Dialog, Tailwind CSS v4 tokens, Vitest, Testing Library.

---

### Task 1: Specify unified channel behavior

**Files:**

- Modify: `apps/workspace/src/domains/settings/components/CodexAccessPanel.test.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.test.tsx`

**Step 1:** Add assertions that the official account is passed into and rendered inside the channel list.

**Step 2:** Add a test proving that the official channel is current whenever relay routing is disabled.

**Step 3:** Add a test proving that clicking a relay card persists `enabled: true`, selects its profile ID, and validates connectivity.

**Step 4:** Run the focused tests and confirm that the new expectations fail before implementation.

### Task 2: Build the unified channel list

**Files:**

- Modify: `apps/workspace/src/domains/settings/components/CodexAccessPanel.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.tsx`

**Step 1:** Replace `beforeContent` with typed official-channel data and account actions.

**Step 2:** Render the official channel first, followed by relay cards with the existing design tokens.

**Step 3:** Make the active route the only blue-highlighted card: official when relay is disabled, or the active relay when enabled.

**Step 4:** Keep the header routing switch synchronized with card activation and preserve rollback behavior on validation failure.

### Task 3: Move relay management off the primary surface

**Files:**

- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.tsx`
- Modify: `apps/workspace/src/domains/settings/components/CodexRelayPanel.test.tsx`

**Step 1:** Add a unified relay editor dialog for name, Base URL, and API Key.

**Step 2:** Preserve secure password input, Key replacement, and Key clearing inside the unified editor.

**Step 3:** Expose edit, connectivity test, and delete actions from each relay card without nesting buttons.

**Step 4:** Verify add, edit, test, Key save, delete, and activation behavior with focused tests.

### Task 4: Verify quality and visual fidelity

**Files:**

- Create: `design-qa.md`

**Step 1:** Run the Codex access and relay component tests.

**Step 2:** Run `pnpm lint`, `pnpm format`, and `pnpm build` in `apps/workspace`.

**Step 3:** Start the workspace app and capture the Codex access page at the reference desktop viewport.

**Step 4:** Compare the implementation against the user-provided CC Switch reference, fix all P0-P2 issues, and record `final result: passed` in `design-qa.md`.
