# Library Assets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current media asset cache into the authoritative asset library for generated and uploaded user assets, excluding project document uploads.

**Architecture:** Rename the persistent asset library table to `library_assets`, keep compatibility routes while the service is migrated, and normalize generated asset references into dedicated tables. Project document uploads remain in `project_assets` and are not part of the asset library.

**Tech Stack:** Go, GORM, SQLite, Gin, React, TypeScript, SWR.

---

### Task 1: Rename Media Asset Storage To Library Assets

**Files:**
- Modify: `services/server/internal/domain/media_models.go`
- Modify: `services/server/internal/repository/db.go`
- Modify: `services/server/internal/repository/media_repo.go`
- Test: `services/server/internal/repository/db_test.go`

**Steps:**
1. Add a schema migration that renames existing `media_assets` to `library_assets`.
2. Change the asset model `TableName()` to `library_assets`.
3. Update index names to use `library_assets_*`.
4. Add repository tests proving legacy databases migrate and new databases create `library_assets` directly.
5. Run `go test ./services/server/internal/repository`.

### Task 2: Extend Asset Library Kinds

**Files:**
- Modify: `services/server/internal/service/media/store.go`
- Modify: `services/server/internal/service/media/pathing.go`
- Modify: `services/server/internal/service/shared/asset_files.go`
- Test: `services/server/internal/service/media/store_test.go`

**Steps:**
1. Allow `text` in asset storage validation.
2. Add save helpers for generated text outputs.
3. Keep binary/project-document uploads out of this service.
4. Run focused media service tests.

### Task 3: Normalize Generated Asset Records

**Files:**
- Create: `services/server/internal/domain/library_asset_models.go` or extend generation models.
- Modify: `services/server/internal/repository/db.go`
- Modify: `services/server/internal/service/generation/*`
- Test: `services/server/internal/service/generation/*_test.go`

**Steps:**
1. Add `generation_task_assets` with `task_id`, `asset_index`, `library_asset_id`, and display metadata.
2. Backfill from `generation_tasks.assets_json`.
3. On generation completion/import, write both compatibility JSON and normalized rows.
4. Run generation service tests.

### Task 4: Normalize Project Resource Selections

**Files:**
- Create repository/service models for `project_resource_assets`.
- Modify selected resource API handlers.
- Test selected-resource listing and updates.

**Steps:**
1. Add `project_resource_assets` referencing `library_assets`.
2. Backfill from `generation_tasks.assets_json selected=true`.
3. Update select/unselect operations to write the new table.
4. Keep JSON selected flags only as temporary compatibility output.

### Task 5: Clean Frontend Asset Library Boundary

**Files:**
- Modify: `apps/workspace/src/domains/workspace/api/media.ts`
- Modify: `apps/workspace/src/domains/workspace/lib/asset-library.ts`
- Modify: `apps/workspace/src/domains/workspace/components/AssetLibraryButton.tsx`
- Test: related workspace/generation frontend tests.

**Steps:**
1. Rename frontend types toward library assets while preserving route compatibility.
2. Remove `projectAssets` from the asset library merge path.
3. Read selected resources from normalized project resource API.
4. Keep project document/file uploads in their own UI path.

### Task 6: Reconcile Existing Local Data

**Files:**
- Modify or create asset migration/doctor service.
- Test migration behavior against legacy paths.

**Steps:**
1. Mark missing legacy asset files with `storage_status=missing`.
2. Register existing text toolbox files as `library_assets`.
3. Include poster paths in consistency checks.
4. Produce a dry-run report before applying file moves.
