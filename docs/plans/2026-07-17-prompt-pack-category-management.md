# Prompt Pack Category Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the prompt categories already stored in each skill pack and let users browse, assign, create, rename, reorder, and remove those categories from the dedicated skill-pack management window.

**Architecture:** Keep `pack_categories` and prompt `metadata.category` as the canonical data model. Extend pack contents with pack-scoped categories, add exact pack-category mutation routes, and update `PromptPackWorkspace` so Skill and prompt navigation are separate modes while prompt entries are grouped by category. Category deletion atomically reassigns affected prompts to a replacement category.

**Tech Stack:** Go, Gin, Gorm, React 19, TypeScript, SWR, shadcn/ui, Vitest.

---

### Task 1: Return pack-scoped categories

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: `services/server/internal/service/promptpack/service_test.go`
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`

**Steps:**
1. Add a failing service test asserting `GetPackContents` returns only categories owned by the selected pack in stored order.
2. Run the focused Go test and confirm the missing `Categories` field fails compilation.
3. Add `Categories []Category` to `PackContents`, load the existing `pack_categories` rows, filter by `pack_id`, and sort by `order` then ID.
4. Add the matching frontend `PromptPackCategory` type and `categories` field.
5. Run the focused Go test and frontend typecheck.
6. Commit on request with `feat(prompt-pack): expose pack categories`.

### Task 2: Add exact category mutation routes

**Files:**
- Modify: `services/server/internal/repository/pack_repo.go`
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: `services/server/internal/service/promptpack/service_test.go`
- Modify: `services/server/internal/http/handlers/packs.go`
- Modify: `services/server/internal/http/handlers/packs_test.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`

**Steps:**
1. Add failing service tests for creating, renaming, reordering, and deleting a pack category.
2. Add a failing test proving category deletion reassigns every affected prompt in the same transaction.
3. Implement pack-scoped create/update/delete service methods using existing `PackCategoryModel` rows.
4. Add `DELETE /packs/:id/categories/:categoryId` with a required replacement ID and POST/PUT routes for create/update.
5. Add frontend API functions and invalidate pack-content caches after mutations.
6. Run focused service and handler tests.
7. Commit on request with `feat(prompt-pack): manage pack categories`.

### Task 3: Separate Skill and prompt navigation

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Replace the old flat/grouped view tests with failing tests for `Skill` and `提示词` tabs.
2. Add a failing test proving prompt entries render under category headings and Skill entries stay flat.
3. Implement the two navigation tabs with counts and keep search scoped to the active type.
4. Group prompt entries by the pack categories returned from the contents endpoint and render unknown references under `未分类`.
5. Run the focused Vitest suite.
6. Commit on request with `feat(workspace): group pack prompts by category`.

### Task 4: Edit prompt category and manage groups

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackContentEditor.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Replace the legacy test that expects category to be hidden with a failing test for visible category selection and metadata preservation.
2. Add failing tests for opening group management, creating a group, renaming/reordering it, and deleting it with a replacement.
3. Render the prompt category in read-only and edit modes using existing Select components.
4. Add a category management view in the main workspace pane with create, rename, ordering, and safe deletion controls.
5. Refresh pack contents and global prompt-library caches after every mutation.
6. Run focused Vitest tests.
7. Commit on request with `feat(workspace): add prompt group management`.

### Task 5: Verify the complete flow

**Files:**
- Verify all modified frontend and Go files.

**Steps:**
1. Run focused Go service and handler tests.
2. Run `pnpm --dir apps/workspace test -- PromptPackEditor.test.tsx`.
3. Run `pnpm --dir apps/workspace lint`, `pnpm --dir apps/workspace format`, and `pnpm --dir apps/workspace build`.
4. Run the server quality gates available in `services/server/Taskfile.yml`.
5. Open the local management window and visually verify Skill navigation, grouped prompts, category assignment, and group management.
6. Inspect the diff for unrelated or generated changes; commit only if requested.
