# Default Prompt Pack Save-As Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the shared default-export package ID with a persisted local fork created by “另存为并导出”, while keeping normal pack imports direct and deterministic.

**Architecture:** The server owns an atomic `ForkPack` operation that snapshots the resolved default pack into a new `local.<uuid>` namespace. The UI invokes this operation only for the default pack, selects the returned local pack, and then uses the existing export pipeline. Direct export of `builtin` is rejected so no artifact can contain a reserved or shared placeholder ID.

**Tech Stack:** Go, Gin, Gorm, SQLite, React 19, TypeScript, SWR, Vitest/Testing Library.

---

### Task 1: Add the transactional default-pack fork

**Files:**
- Modify: `services/server/internal/service/promptpack/service.go`
- Test: `services/server/internal/service/promptpack/service_test.go`

**Steps:**
1. Add failing tests proving two forks receive different `local.<uuid>` IDs, resolved default overrides are copied, category ownership is rewritten, and a fork reuses its ID across exports.
2. Add `ForkPackInput` and `ForkPack(ctx, sourcePackID, input)`.
3. Generate the ID on the server, validate metadata, and persist pack, categories, and resolved entries in one repository transaction.
4. Clear release/provenance/override metadata on the local snapshot.
5. Run the focused prompt-pack service tests.

### Task 2: Prevent placeholder default exports and expose the fork API

**Files:**
- Modify: `services/server/internal/service/promptpack/import_export.go`
- Modify: `services/server/internal/http/handlers/packs.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Test: `services/server/internal/http/handlers/packs_test.go`
- Test: `services/server/internal/service/promptpack/service_test.go`

**Steps:**
1. Add failing tests for `POST /packs/builtin/fork` and rejection of `GET /packs/builtin/export`.
2. Remove the shared `mediago.default-prompts` export rewrite.
3. Return a typed invalid-pack error when direct default export is attempted.
4. Add the fork request DTO, handler, route, and API documentation comments.
5. Run focused handler and service tests.

### Task 3: Add the save-as-and-export client flow

**Files:**
- Modify: `apps/workspace/src/domains/settings/api/packs.ts`
- Modify: `apps/workspace/src/domains/settings/api/packs.test.ts`
- Modify: `apps/workspace/src/pages/PromptPackEditor.tsx`
- Modify: `apps/workspace/src/pages/PromptPackEditor.test.tsx`

**Steps:**
1. Add a typed `forkPromptPack` API function and test its request/response behavior.
2. Add UI tests proving the default pack shows “另存为并导出” and local packs still show “导出”.
3. Add a small save-as dialog with defaulted name, version, and description.
4. Flush and validate before opening/confirming the fork; after success refresh caches, select the local fork, and export that returned ID.
5. Preserve the fork when native file saving is cancelled or export fails.
6. Run the focused workspace tests.

### Task 4: Verify quality gates

**Files:**
- Modify only files required to fix discovered failures.

**Steps:**
1. Run `gofmt` on changed Go files.
2. Run focused Go and frontend tests.
3. Run the server `task check`, `task test`, and `task build` gates when available.
4. Run workspace `pnpm lint`, `pnpm format`, and `pnpm build` gates using the repository's existing package filters/scripts.
5. Review `git diff` and report any unrelated pre-existing failures separately.
