# Section ID Lifecycle Implementation Plan

**Goal:** Persist stable document section identities and metadata, then keep them synchronized whenever workspace Markdown content changes.

**Architecture:** Markdown remains the source for document content and only stores the `section-id` identity anchor. SQLite/Gorm stores section metadata and current observation state. A document reconcile service scans Markdown, creates missing section IDs, updates section observations, and marks missing/detached/duplicated records.

**Tech Stack:** Go, Gin, Gorm, SQLite, fsnotify workspace watcher, React workspace consumers.

---

### Task 1: Section Persistence

**Files:**
- Modify: `services/server/internal/domain/workspace_models.go`
- Modify: `services/server/internal/repository/db.go`
- Create: `services/server/internal/repository/document_section_repo.go`
- Test: `services/server/internal/repository/document_section_repo_test.go`

**Steps:**
1. Add a `DocumentSectionModel` Gorm model with `project_id`, `section_id`, `document_id`, type/subtype, status, title/line/hash observations, metadata JSON, and timestamps.
2. Include the model in workspace schema migration.
3. Add repository methods for listing, batch upserting, and marking stale records by project.
4. Test upsert/list behavior and stale status transitions.

### Task 2: Section Reconcile Service

**Files:**
- Create: `services/server/internal/service/document/sections.go`
- Test: `services/server/internal/service/document/sections_test.go`

**Steps:**
1. Scan workspace documents for heading sections and `<!-- section-id: ... -->` anchors.
2. Generate stable IDs for headings without anchors and write them back to Markdown content.
3. Detect detached anchors, duplicates, moved sections, updated content hashes, and missing DB rows.
4. Persist section observations without overwriting user-owned metadata.
5. Return a response containing persisted section records.

### Task 3: Wire Document Change Flow

**Files:**
- Modify: `services/server/internal/service/document/local_file_sync.go`
- Modify: `services/server/internal/app/workspace_file_watcher.go`

**Steps:**
1. Run reconcile from local Markdown sync, which is called by the workspace file watcher debounce flush.
2. Run reconcile before publishing workspace document change events.
3. Keep reconcile idempotent so its own section-id writebacks do not create an event loop.
4. Leave normal in-app create/update/section mutation paths unchanged; they keep their existing response and version semantics.

### Task 4: HTTP API

**Files:**
- Modify: `services/server/internal/http/handlers/workspace.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `services/server/internal/app/workspace/state.go`

**Steps:**
1. Add `GET /api/v1/projects/:projectId/workspace/sections`.
2. Add `POST /api/v1/projects/:projectId/workspace/sections/reconcile`.
3. Return section metadata and observation status for canvas/generation/clip consumers.

### Task 5: Verification

**Commands:**
- `cd services/server && task check`
- `cd apps/workspace && pnpm run lint`
- `cd apps/workspace && pnpm run format`
- `cd apps/workspace && pnpm run build`

**Acceptance Criteria:**
- Newly added headings receive stable `section_id` anchors.
- Existing `section_id` records survive title edits, movement, and body edits.
- Missing, detached, and duplicated sections are represented in DB status.
- Section metadata is stored in DB, not Markdown comments.
- Workspace watcher-triggered document changes reconcile sections before publishing refresh events.
