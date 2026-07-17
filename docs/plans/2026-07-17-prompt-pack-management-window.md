# Prompt Pack Management Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Skill and prompt creation, editing, reset, and deletion into the dedicated prompt-pack management window while leaving the settings page as a read-only catalog and launcher.

**Architecture:** Keep the existing package-centric `PromptPackWorkspace` as the single editing surface and expand it from local drafts to all installed packs. Use exact pack-entry APIs for mutations so duplicate slugs in different packs remain unambiguous; formal packs receive user overlays/tombstones rather than mutating their installed artifacts. The settings panel continues to show the resolved Skill/prompt catalog but no longer renders mutation controls.

**Tech Stack:** React 19, TypeScript, SWR, Electron IPC, Go, Gin, prompt-pack service, Vitest, Go testing.

---

### Task 1: Lock down the management-window entry behavior

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPacksPanel.test.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Change the management-entry test to expect `openPromptPackEditor()` without `mode=create`.
2. Add editor tests proving default, imported, and local packs are listed.
3. Add tests proving opening the manager does not display the create-pack dialog.
4. Run the focused Vitest files and confirm the new expectations fail before implementation.

### Task 2: Support exact formal-pack entry overlays

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: `services/server/internal/service/promptpack/service_test.go`
- Modify: `services/server/internal/http/handlers/packs.go`

**Steps:**
1. Add service tests for creating a user draft inside the default pack namespace.
2. Add service tests for hiding an exact formal-pack entry and restoring it with pack reset.
3. Allow `CreatePackEntryDraft` to create user-owned overlay entries for any installed pack.
4. Make `RemoveEntry` delete user-created entries and write a hidden user overlay for package-backed entries.
5. Update handler descriptions and run prompt-pack service/handler tests.

### Task 3: Expand the dedicated window to all packs

**Files:**
- Modify: `apps/workspace/src/pages/PromptPackEditor.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Pass all installed packs into the workspace instead of filtering to `source === "local"`.
2. Rename the window heading and copy from “editor/local draft” to “management/all packs”.
3. Add source badges and source-aware empty/loading copy in the pack list and overview.
4. Add selected-entry reset using `resetPromptPackEntry` and exact deletion using `removePromptPackEntry`.
5. Keep pack deletion available only to local/imported packs; expose pack reset for default/imported packs.
6. Verify edits still flush before close and pack switching remains blocked while dirty.

### Task 4: Make settings a catalog and launcher

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPacksPanel.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/SkillsEditorPanel.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptLibraryEditorPanel.tsx`
- Modify: related component tests

**Steps:**
1. Replace the management popover’s “制作” shortcut with a single “技能包管理” launcher that passes no create mode.
2. Add a `showActions`/read-only presentation option to Skill and prompt catalog panels.
3. Hide create/edit/reset/delete controls on the settings route while preserving browsing, filtering, membership badges, import, and pack enable state.
4. Run focused settings component tests.

### Task 5: Verify the complete change

**Files:**
- Verify all modified frontend and Go files.

**Steps:**
1. Run `pnpm --dir apps/workspace test` for the affected suites.
2. Run `pnpm --dir apps/workspace format`, `lint`, and `build`.
3. Run prompt-pack Go service and handler tests, then the service quality gates that are available locally.
4. Inspect the final diff for unrelated or generated changes and confirm the earlier traffic-light fix remains intact.
