# Prompt Pack Card Metadata Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant prompt-pack overview screen and let users edit local pack names and descriptions directly from the management card while keeping default and imported packs read-only.

**Architecture:** Extend the existing pack PATCH endpoint with a local-only metadata mutation, expose it through the workspace API client, and add a card-level edit dialog. Pack navigation will open the first available entry directly and show a small empty state only when a pack has no content.

**Tech Stack:** Go, Gin, Gorm repository-backed prompt-pack service, React 19, TypeScript, SWR, shadcn/ui, Vitest.

---

### Task 1: Add backend metadata mutation and authorization

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Modify: `services/server/internal/service/promptpack/service_test.go`
- Modify: `services/server/internal/http/handlers/packs.go`
- Modify: `services/server/internal/http/handlers/packs_test.go`

1. Add failing service tests for local metadata updates and read-only default/imported packs.
2. Implement `UpdatePackMetadata`, validating the name and using the existing read-only source guard before persistence.
3. Extend `PATCH /packs/:id` to accept `name` and `description` as an alternative to `enabled`.
4. Add handler regression tests for success, invalid input, and forbidden sources.

### Task 2: Add the card metadata editor

**Files:**
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`
- Modify: `apps/workspace/src/pages/PromptPackEditor.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

1. Add the metadata PATCH client.
2. Add a controlled name/description dialog owned by the editor page.
3. Add a bottom-right edit icon to local cards only, keeping hover geometry fixed and preventing card navigation when clicking controls.
4. Refresh the pack list after a successful save and cover local/default/imported visibility in tests.
5. Render imported-pack descriptions on their cards.

### Task 3: Remove the overview page

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

1. Remove the “技能包概览” navigator item and metadata overview component.
2. Select the first entry automatically whenever a manageable pack is opened.
3. Fall back to another entry after deletion and show a content-only empty state when no entries exist.
4. Add navigation regression tests.

### Task 4: Verify the change

1. Run focused backend and frontend tests.
2. Run Go formatting, checks, tests, and build.
3. Run workspace lint/check and build.
4. Run `git diff --check` and review only the scoped diff.
