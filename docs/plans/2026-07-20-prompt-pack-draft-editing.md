# Prompt Pack Transactional Draft Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the current mixed prompt-pack editor into a strict read/edit workflow where every content mutation remains a reversible local draft until one explicit, atomic Save.

**Architecture:** The current UI already places prompt groups and prompt drag/drop in the left navigator, so that layout remains intact. Replace the entry-only `drafts` map with a Zustand edit-session store persisted through the `persist` middleware to `localStorage`; all sidebar and editor actions mutate only the working snapshot. Save submits one revision-checked draft command to the Go service, which validates and commits the complete change set inside one Gorm transaction; “放弃草稿” removes the persisted session and returns to server content.

**Tech Stack:** React 19, TypeScript, SWR, @dnd-kit/core, shadcn/ui, Vitest, Go, Gin, Gorm, SQLite

---

## Confirmed behavior

Use explicit Save, not autosave.

| State | Allowed |
| --- | --- |
| Read mode | Select and inspect Skill/prompt content; switch tabs; return to pack list; export local packs |
| Edit mode | Create/delete/update Skill and prompts; create/rename/delete/reorder groups; move prompts between groups; edit entry fields |
| Abandon draft | Remove the complete persisted working snapshot and return to the server version |
| Save | Validate the whole draft and make one atomic backend request |
| Save failure/conflict | Stay in edit mode and retain the complete working draft |
| Close/navigate | Leave the persisted draft intact; never auto-save formal data |

Enable/disable, pack-card metadata editing, copying, exporting, and uninstalling remain pack-list operations. They are not part of the content edit session.

## Findings in the latest code

The latest sidebar refactor is valid and should be preserved:

- The separate category-management view has been removed.
- `PromptCategoryNavigatorGroups` now owns group edit/delete dialogs and drop zones.
- Prompt cross-group movement already writes to local `drafts` through `movePromptToCategory`.
- Group counts were removed from sidebar labels.

The remaining inconsistencies are:

- `createEntry` calls `createPromptPackEntry` immediately.
- `removeEntry` calls `removePromptPackEntry` immediately.
- `createCategoryRecord`, `updateCategory`, and `deleteCategory` write immediately.
- `changeEntryCategory` still supports a direct, non-edit update path.
- `saveAll` saves only changed entry fields and cannot commit structural draft changes.
- `discard` clears entry drafts only; it cannot restore changes already persisted.
- `changedEntries` ignores create/delete/group/order changes, so Save/dirty state is incomplete.
- Entry delete/reset affordances are gated by pack source, not consistently by `isEditing`; `confirmRemoveEntry` uses `blockWhileEditing` in the wrong direction.
- The current window-close handler calls `flush()` automatically instead of asking whether to Save, Discard, or keep editing.
- Current tests intentionally expect immediate create/group writes and direct category changes outside edit mode; those expectations must be replaced.

The persisted-draft behavior is specified in `docs/plans/2026-07-20-prompt-pack-local-draft-design.md`.

## API shape

Use a revisioned desired-state endpoint:

```http
PUT /api/v1/packs/{id}/contents
```

```ts
interface SavePromptPackDraftInput {
  baseRevision: string;
  entries: PromptPackDraftEntry[];
  categories: PromptPackDraftCategory[];
}
```

`GET /packs/:id/contents` returns a deterministic `revision`. The PUT response is canonical `PromptPackContents` with the next revision. The service compares the submitted revision, validates the desired graph, derives the necessary domain mutations while preserving immutable provenance/link fields, and executes them inside one transaction.

Do not let the client overwrite `source`, release/provenance fields, linked references, or override identity. Existing granular endpoints remain for compatibility but are no longer called by `PromptPackWorkspace`.

### Task 1: Lock the latest UI contract with failing tests

**Files:**
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Step 1: Replace obsolete immediate-write tests**

Replace these current expectations:

- `persists a new prompt before opening the normal autosave editor`
- immediate `createPromptPackCategory` / `updatePromptPackCategory` / `deletePromptPackCategory` calls
- `updates a prompt category directly without entering pack edit mode`
- multi-call `updatePromptPackEntry` Save expectations

with tests asserting:

```ts
expect(createPromptPackEntry).not.toHaveBeenCalled();
expect(removePromptPackEntry).not.toHaveBeenCalled();
expect(createPromptPackCategory).not.toHaveBeenCalled();
expect(updatePromptPackCategory).not.toHaveBeenCalled();
expect(deletePromptPackCategory).not.toHaveBeenCalled();
expect(updatePromptPackEntry).not.toHaveBeenCalled();
```

after every draft action and before Save.

**Step 2: Add a full mixed-session abandon test**

Start with two prompt groups, one Skill, and two prompts. Enter Edit and perform all of the following:

1. Create a Skill.
2. Create a prompt.
3. Delete an existing prompt.
4. Rename a group.
5. Create a group.
6. Move a prompt to another group.
7. Reorder two groups.
8. Edit a field/body.
9. Click “放弃草稿” and confirm.

Assert that the original entries, group names, membership, and order are restored, the persisted Store entry is removed, and no mutation API was called.

**Step 3: Add strict read-mode tests**

Before clicking Edit, assert there is no:

- new Skill button;
- new group or new prompt button;
- entry delete/reset button;
- group rename/delete/reorder handle;
- prompt drag handle;
- enabled category Select.

Entry selection must still work in read mode.

**Step 4: Add Save failure and persistence tests**

Assert that:

- one Save failure leaves the draft visible and keeps “放弃草稿”/Save controls;
- window close, refresh, back, and pack switching do not call Save automatically;
- reopening stays in read mode and shows “发现未保存草稿”;
- “继续编辑” restores the complete persisted working snapshot;
- “放弃草稿” deletes the persisted draft and restores server content.

**Step 5: Run the focused tests and verify failures**

Run:

```bash
pnpm --dir apps/workspace exec vitest run src/pages/PromptPackEditor.test.tsx
```

Expected: FAIL because the current implementation persists structural changes immediately and auto-flushes on close.

**Step 6: Commit the test contract**

```bash
git add apps/workspace/src/pages/PromptPackEditor.test.tsx
git commit -m "test(prompt-pack): define transactional edit sessions"
```

### Task 2: Add deterministic content revisions on the backend

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Test: `services/server/internal/service/promptpack/service_test.go`

**Step 1: Write failing revision tests**

Test that `GetPackContents`:

- returns a non-empty revision;
- returns the same revision for unchanged canonical content;
- changes revision when an editable entry or category changes;
- is not affected by map iteration or input slice order;
- excludes counts, timestamps, and transient linked-reference diagnostics from the digest.

**Step 2: Run the failing tests**

```bash
cd services/server && go test ./internal/service/promptpack -run 'Test.*PackContentsRevision' -count=1
```

Expected: FAIL because `PackContents` has no revision.

**Step 3: Implement the minimal revision contract**

Add:

```go
type PackContents struct {
    Pack       Pack       `json:"pack"`
    Entries    []Entry    `json:"entries"`
    Categories []Category `json:"categories"`
    Revision   string     `json:"revision"`
}
```

Create canonical private structs containing persisted identity/content fields only. Sort copies of entries/categories, encode with `encoding/json`, and hash with SHA-256. Go JSON encoding already orders string map keys, but nested values must still be limited to supported JSON types.

**Step 4: Run the focused tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add services/server/internal/service/promptpack/service.go services/server/internal/service/promptpack/service_test.go
git commit -m "feat(prompt-pack): add content revisions"
```

### Task 3: Implement atomic desired-state saving

**Files:**
- Modify: `services/server/internal/repository/pack_repo.go`
- Modify: `services/server/internal/service/promptpack/service.go`
- Test: `services/server/internal/service/promptpack/service_test.go`

**Step 1: Write failing service tests**

Add table-driven `SavePackDraft` tests for:

- mixed create/update/delete/move/reorder in one commit;
- a stale `baseRevision` returning `ErrPackConflict`;
- default/imported packs returning `ErrPackReadonly`;
- duplicate IDs/slugs or category IDs;
- blank names, invalid kind/slug/body, missing prompt category;
- deleting the last category while prompts remain;
- preserving release, source-package, source-release, linked-reference, and override fields from stored rows;
- package-backed deletion retaining existing tombstone semantics;
- any validation or persistence failure rolling the entire transaction back.

**Step 2: Run and verify failure**

```bash
cd services/server && go test ./internal/service/promptpack -run 'TestSavePackDraft' -count=1
```

Expected: FAIL because `SavePackDraft` and `ErrPackConflict` do not exist.

**Step 3: Add pack-scoped repository helpers**

Add concrete helpers instead of loading all rows and filtering:

```go
ListEntriesByPack(packID string) ([]domain.PackEntryModel, error)
ListCategoriesByPack(packID string) ([]domain.PackCategoryModel, error)
```

Reuse `WithTransaction`; do not expose Gorm outside the repository.

**Step 4: Implement preflight validation**

Before the first write, normalize the desired state and validate the complete graph in memory. Load the current stored rows into maps so immutable fields can be preserved. For new entries, derive the canonical entry ID from pack ID/kind/slug on the server and verify it matches the submitted identity.

**Step 5: Implement one transaction**

Inside `store.repo.WithTransaction`:

1. Load and reject any pack whose normalized source is not `local`.
2. Read current pack-scoped rows and compare the current digest with `BaseRevision`.
3. Validate desired categories and entries before writes.
4. Apply category upserts in desired order.
5. Apply entry upserts while preserving immutable provenance.
6. Apply removals with the same user-row/delete versus package-row/tombstone rules as `RemoveEntry`.
7. Delete categories absent from desired state after prompts have moved.
8. Read canonical committed contents and produce the next revision.

Factor shared transactional helpers instead of calling public service methods that use `store.repo` outside the active transaction.

**Step 6: Run focused tests**

```bash
cd services/server && go test ./internal/service/promptpack -run 'TestSavePackDraft|Test.*PackContentsRevision' -count=1
```

Expected: PASS.

**Step 7: Commit**

```bash
git add services/server/internal/repository/pack_repo.go services/server/internal/service/promptpack/service.go services/server/internal/service/promptpack/service_test.go
git commit -m "feat(prompt-pack): save content drafts atomically"
```

### Task 4: Expose and test `PUT /packs/:id/contents`

**Files:**
- Modify: `services/server/internal/http/handlers/packs.go`
- Modify: `services/server/internal/http/handlers/packs_test.go`
- Modify: `services/server/internal/http/routes/routes.go`

**Step 1: Write failing handler tests**

Cover success, malformed input, validation failure, default/imported denial, stale revision, and atomic rollback. Assert HTTP 409 for `ErrPackConflict`, 403 for `ErrPackReadonly`, and 400 for invalid graph data.

**Step 2: Run and verify failure**

```bash
cd services/server && go test ./internal/http/handlers -run 'TestPromptPacksHandler.*Draft' -count=1
```

Expected: FAIL because the route does not exist.

**Step 3: Add a thin handler and route**

Add request DTOs, map them to `promptpack.SavePackDraftInput`, call the service, and return canonical `PackContents`. Register:

```go
apiRoutes.PUT("/packs/:id/contents", handlers.PromptPacks.HandlePutPackContents)
```

Update `writePromptPackError` with the conflict mapping and add Swagger annotations.

**Step 4: Run focused tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add services/server/internal/http/handlers/packs.go services/server/internal/http/handlers/packs_test.go services/server/internal/http/routes/routes.go
git commit -m "feat(prompt-pack): expose atomic draft save"
```

### Task 5: Add the frontend draft model, persisted Zustand Store, and API client

**Files:**
- Create: `apps/workspace/src/domains/settings/lib/prompt-pack-draft.ts`
- Create: `apps/workspace/src/domains/settings/lib/prompt-pack-draft.test.ts`
- Create: `apps/workspace/src/domains/settings/stores/prompt-pack-drafts.ts`
- Create: `apps/workspace/src/domains/settings/stores/prompt-pack-drafts.test.ts`
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`
- Modify: `apps/workspace/src/domains/settings/api/packs.test.ts`

**Step 1: Write failing pure model tests**

Define an edit session:

```ts
interface PromptPackEditSession {
  base: PromptPackContents;
  working: PromptPackContents;
}
```

Test immutable helpers for entry create/update/delete/reset, category create/rename/delete/reorder, prompt movement, normalized dirty detection, full validation, discard, and request serialization. Verify metadata not owned by the editor survives a category move.

Use client-generated slugs/category IDs so unsaved sidebar rows have stable React/DnD identities. The backend remains authoritative for canonical entry IDs.

**Step 2: Run and verify failure**

```bash
pnpm --dir apps/workspace exec vitest run src/domains/settings/lib/prompt-pack-draft.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the pure module**

Keep draft transition logic out of both `PromptPackWorkspace.tsx` and the persisted Store implementation. Export narrowly named pure functions; Store actions call those functions and own persistence only. Dirty equality must compare normalized entries, categories, membership, and category order—not the currently selected entry or navigator tab.

**Step 4: Add the persisted Zustand Store**

Follow the existing Store pattern used by `apps/workspace/src/lib/stores/work-mode.ts`:

```ts
create<PromptPackDraftState>()(
  persist(
    immer((set) => ({ /* actions */ })),
    {
      name: "prompt-pack-drafts.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ draftsByPackId: state.draftsByPackId }),
      merge: normalizePersistedPromptPackDrafts,
    },
  ),
);
```

Persist one working snapshot per pack with `packId`, `baseRevision`, and `updatedAt`. Add Store tests for reload hydration, per-pack isolation, removal after abandon/save, corrupted JSON/shape normalization, and version migration. Do not debounce synchronous `localStorage` writes because closing immediately after a keystroke must not lose the final change.

**Step 5: Add the API client**

Add `revision` to `PromptPackContents` and implement:

```ts
savePromptPackDraft(packID, input): Promise<PromptPackContents>
```

using `httpClient.put(promptPackContentsKey(packID), input)`.

Update the HTTP mock in `packs.test.ts` to expose `get`, `post`, and `put`; add an exact request-shape test.

**Step 6: Run tests**

```bash
pnpm --dir apps/workspace exec vitest run src/domains/settings/lib/prompt-pack-draft.test.ts src/domains/settings/stores/prompt-pack-drafts.test.ts src/domains/settings/api/packs.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/workspace/src/domains/settings/lib/prompt-pack-draft.ts apps/workspace/src/domains/settings/lib/prompt-pack-draft.test.ts apps/workspace/src/domains/settings/stores/prompt-pack-drafts.ts apps/workspace/src/domains/settings/stores/prompt-pack-drafts.test.ts apps/workspace/src/domains/settings/api/packs.ts apps/workspace/src/domains/settings/api/packs.test.ts
git commit -m "feat(prompt-pack): persist full draft sessions"
```

### Task 6: Integrate the draft into the latest sidebar workspace

**Files:**
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx`
- Modify: `apps/workspace/src/domains/settings/components/debug/PromptPackContentEditor.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Step 1: Replace entry-only state with the persisted Store**

In `PromptPackWorkspace.tsx`, remove `drafts`, `changedEntries`, and structural request busy state as the source of truth. Select the current pack draft from `usePromptPackDraftStore`; derive displayed `entries`, `categories`, selected entry, tab counts, drop groups, and editor draft from its working snapshot while editing and SWR contents otherwise.

Initialize a new session only on the transition into Edit after contents are available. If a persisted draft exists, remain in read mode and show a recovery banner; enter edit mode only after “继续编辑”. Do not replace a persisted draft during SWR revalidation.

**Step 2: Convert every content action to a pure transition**

Replace calls from these functions:

- `createEntry`
- `removeEntry`
- `resetEntry`
- `changeEntryCategory`
- `movePromptToCategory`
- `createCategoryRecord`
- `updateCategory`
- `deleteCategory`

with draft-model transitions. Keep confirmation dialogs, but their confirm callbacks mutate the working snapshot only.

Remove `blockWhileEditing` from entry deletion. Use it only for actions that leave the active edit session. All mutation callbacks must begin with `if (!isEditing || readOnly) return` or be unreachable because their controls are absent.

**Step 3: Restore group sorting in the current navigator**

The latest code supports dragging prompts between group drop zones but no longer has group sorting. Add a dedicated group drag handle to the group header using a distinct DnD data type:

```ts
{ type: "category", categoryID }
```

Handle category-to-category drops by reordering `session.working.categories`. Keep prompt-to-category drops mapped to membership changes. Add the requested tooltip/title: `拖拽移动分组`.

**Step 4: Enforce read-mode controls**

Pass an explicit `editable={isEditing && !selectedPackReadonly}` into sidebar rows/groups rather than using only `readOnly`. Show entry delete/reset, group controls, add buttons, prompt drag handles, and group drag handles only when editable.

In `PromptPackContentEditor.tsx`, disable the shadcn category Select whenever `!isEditing || readOnly`; delete the direct non-edit category update path and its obsolete test.

**Step 5: Implement one Save and exact abandon**

`saveAll` must:

1. Validate all working entries/categories.
2. Return true without a request when normalized base equals working.
3. Call `savePromptPackDraft` exactly once.
4. Update the selected SWR cache with the canonical response.
5. Revalidate pack list/global content caches once.
6. Retain the session on failure or 409.

`discard`/“放弃草稿” must remove the current pack from the Zustand Store, clear draft errors, and return to SWR server content. Because no mutations were sent, no rollback request is required. Successful Save must also remove the persisted draft.

**Step 6: Run focused UI and model tests**

```bash
pnpm --dir apps/workspace exec vitest run src/pages/PromptPackEditor.test.tsx src/domains/settings/lib/prompt-pack-draft.test.ts src/domains/settings/stores/prompt-pack-drafts.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/workspace/src/domains/settings/components/debug/PromptPackWorkspace.tsx apps/workspace/src/domains/settings/components/debug/PromptPackContentEditor.tsx apps/workspace/src/pages/PromptPackEditor.test.tsx
git commit -m "refactor(prompt-pack): use transactional sidebar drafts"
```

### Task 7: Correct Save, abandon, recovery, navigation, export, and close lifecycle

**Files:**
- Modify: `apps/workspace/src/pages/PromptPackEditor.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Step 1: Keep explicit header semantics**

- Edit creates the workspace session.
- Save is enabled only when the complete session is dirty and no save is running.
- “放弃草稿” requires destructive confirmation, removes the persisted session, and exits edit mode.
- Saving successfully exits edit mode.
- Failed Save keeps edit mode.
- A persisted draft discovered on load does not automatically enter edit mode.

**Step 2: Replace automatic close flush with local persistence**

The existing Electron callback currently invokes `workspaceRef.current?.flush()` immediately. Remove that formal auto-save. Because every working transition is synchronously persisted by Zustand to `localStorage`, allow close without a backend mutation and leave the draft available for the next launch. If persistence reports a storage/quota failure, deny silent close and show that the current draft may be lost.

**Step 3: Add recovery and conflict UI**

In read mode, when the selected pack has a persisted draft:

- show “发现未保存草稿” with its local `updatedAt`;
- show “继续编辑” and destructive “放弃草稿” actions;
- compare `baseRevision` with fetched contents revision;
- if mismatched, show “草稿基于旧版本” and disable Continue/Save, leaving only abandon in the first version.

**Step 4: Guard navigation and export**

Pack selection/back may proceed because the draft is persisted per pack. Do not auto-save or auto-discard. Export while editing must explicitly Save first or stop; it must not silently publish a local draft.

**Step 5: Run focused tests**

```bash
pnpm --dir apps/workspace exec vitest run src/pages/PromptPackEditor.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/workspace/src/pages/PromptPackEditor.tsx apps/workspace/src/pages/PromptPackEditor.test.tsx
git commit -m "fix(prompt-pack): recover persisted drafts across editor lifecycle"
```

### Task 8: Full verification

**Files:**
- Modify only files required by discovered failures.

**Step 1: Run backend tests**

```bash
cd services/server && go test -race ./internal/service/promptpack ./internal/http/handlers
```

Expected: PASS.

**Step 2: Run all workspace tests**

```bash
pnpm --dir apps/workspace test
```

Expected: PASS.

**Step 3: Run frontend gates**

```bash
pnpm --dir apps/workspace check
pnpm --dir apps/workspace build
```

Expected: PASS.

**Step 4: Run server gates**

```bash
cd services/server && task check
```

Expected: PASS.

**Step 5: Manual acceptance**

1. In read mode, inspect entries and verify every mutation affordance is absent/disabled.
2. Enter Edit and make mixed entry/group/body/order changes; verify DevTools shows zero mutation requests.
3. Click “放弃草稿” and verify exact visual restoration, including group order and membership.
4. Repeat and Save; verify exactly one `PUT /packs/:id/contents` request.
5. Force a 500; verify the draft remains and no partial server change is visible after reload.
6. Create a stale revision in a second window; verify 409 and no overwrite.
7. Attempt the PUT manually for default/imported packs; verify 403.
8. Close/navigate with a dirty draft, reopen the pack, and verify the read-mode recovery banner and complete restoration.

**Step 6: Commit regression fixes**

```bash
git add <only-files-changed-for-regression-fixes>
git commit -m "test(prompt-pack): verify transactional editing"
```

## Compatibility notes

- Preserve the latest left-sidebar category design; do not recreate the removed category-management page.
- Keep existing granular backend routes until repository-wide call sites are migrated, but prohibit their use from this editor.
- No schema migration is required because revision is derived from canonical persisted content.
- The backend remains the authority for local/default/imported permissions; hiding controls is only UX.
- Revalidate SWR caches once after Save, never after individual draft transitions.
- Do not add fallback multi-request saving. If the atomic endpoint fails, retain the draft and report the failure.

## Definition of done

- No content mutation is possible before Edit.
- Every edit action is immediately visible but produces no backend mutation.
- “放弃草稿” removes the persisted working snapshot and restores server content exactly.
- Save produces one revision-checked, transactionally atomic request.
- Save failure/conflict preserves the entire working draft.
- Read/edit UI, recovery, navigation, export, and window close all follow the same persisted-draft lifecycle.
- Default/imported packs remain backend-protected.
- Full frontend and backend quality gates pass.
