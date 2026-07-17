# Prompt Creation Category Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to select an existing prompt group or create and select a new group while creating a prompt-pack prompt.

**Architecture:** Extend the pack-entry creation request with an optional `categoryId`. The server validates an explicitly supplied prompt category in the target pack and stores it in the new draft metadata atomically. The existing creation dialog receives pack categories and the existing category-creation callback, so inline category creation immediately selects the returned category.

**Tech Stack:** React 19, TypeScript, shadcn/ui, SWR, Vitest, Go, Gin, Gorm.

---

### Task 1: Specify prompt creation behavior

**Files:**
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`
- Modify: `services/server/internal/service/promptpack/service_test.go`
- Modify: `services/server/internal/http/handlers/packs_test.go`

**Steps:**
1. Add a frontend test that selects an existing group before creating a prompt.
2. Add a frontend test that creates a group inline and verifies it becomes the submitted group.
3. Add service and handler assertions for an explicit valid category and an unknown category.
4. Run focused tests and confirm the new assertions fail before implementation.

### Task 2: Extend atomic prompt draft creation

**Files:**
- Modify: `services/server/internal/http/handlers/packs.go`
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: affected Go tests and call sites.

**Steps:**
1. Add `categoryId` to the create-entry request.
2. Pass it into the prompt-pack service.
3. Validate explicit prompt categories against the current pack.
4. Store the chosen category in draft metadata while preserving the legacy default when omitted.
5. Run focused Go tests.

### Task 3: Add group controls to the creation dialog

**Files:**
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Test: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Add `categoryId` to the frontend request type.
2. Pass resolved categories and a category-creation callback into `CreateEntryDialog`.
3. Show a group selector only for prompt creation.
4. Add inline group creation and automatically select the returned group.
5. Disable prompt creation until a group is selected.
6. Run focused frontend tests.

### Task 4: Verify the complete change

**Files:**
- Verify all modified frontend and backend files.

**Steps:**
1. Run frontend formatting, lint, build, and tests.
2. Run server formatting, lint, build, and race tests.
3. Inspect the local dialog visually and verify both existing-group and new-group states.
4. Run `git diff --check` and report results.
