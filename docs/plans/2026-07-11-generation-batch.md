# Generation Batch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one persisted batch-generation contract used by the project batch dialog and the generation MCP.

**Architecture:** Group normal generation tasks with server-owned batch metadata and submit each child through the existing generation service. Expose the same ordered batch result over HTTP and MCP, while retaining existing task polling, notification, retry, and selection behavior.

**Tech Stack:** Go, Gin, Gorm/SQLite, MCP Go SDK, React 19, TypeScript, SWR, Vitest.

---

### Task 1: Persist batch metadata on normal generation tasks

**Files:**
- Modify: `services/server/internal/domain/generation_models.go`
- Modify: `services/server/internal/repository/generation_task_repo.go`
- Modify: `services/server/internal/service/generation/generation_tasks_service.go`
- Modify: `services/server/internal/http/dto/generation.go`
- Test: `services/server/internal/repository/generation_task_repo_test.go`
- Test: `services/server/internal/service/generation/generation_tasks_service_test.go`

**Steps:**
1. Add failing tests for storing, reading, and listing tasks by `batchId` in `batchIndex` order.
2. Run the focused Go tests and confirm they fail.
3. Add nullable-compatible batch fields to the domain model and DTO record.
4. Map the fields through task persistence and add the repository query.
5. Run the focused tests and confirm they pass.

### Task 2: Implement the batch service contract

**Files:**
- Modify: `services/server/internal/http/dto/generation.go`
- Modify: `services/server/internal/service/generation/generation_svc.go`
- Create: `services/server/internal/service/generation/generation_batch.go`
- Test: `services/server/internal/service/generation/generation_batch_test.go`

**Steps:**
1. Add failing tests for empty/oversized batches, duplicate item IDs, ordered success, and partial failure.
2. Run the focused test and confirm it fails to compile before implementation.
3. Add request/response DTOs and internal batch metadata fields on generation requests.
4. Implement bounded child submission through the existing plain/optimized service methods.
5. Add batch status/count aggregation and persisted batch lookup.
6. Run the focused tests and confirm they pass.

### Task 3: Expose HTTP batch endpoints

**Files:**
- Modify: `services/server/internal/http/handlers/generation_tasks.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Test: `services/server/internal/http/handlers/generation_tasks_test.go`

**Steps:**
1. Add handler tests for POST validation, partial success, and GET lookup.
2. Run the handler tests and confirm they fail.
3. Add service interface methods and Gin handlers.
4. Register `POST /generation/batches` and `GET /generation/batches/:batchId/tasks`.
5. Run the handler tests and confirm they pass.

### Task 4: Add the generation MCP batch tool

**Files:**
- Modify: `packages/mcp/pkg/mcp/generation_types.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/internal/tools/generation/register.go`
- Modify: `packages/mcp/pkg/server/store.go`
- Modify: `packages/mcp/pkg/server/server_test.go`
- Modify: `services/server/internal/app/mcp/generation_server.go`
- Modify: `services/server/internal/app/mcp/generation.go`
- Modify: `services/server/internal/app/mcp/generation_convert.go`
- Test: `services/server/internal/app/mcp/generation_test.go`

**Steps:**
1. Add failing registration and adapter tests for `generate_media_batch`.
2. Run package and server MCP tests and confirm they fail.
3. Add typed batch input/output records and tool metadata.
4. Register the tool and extend dependency interfaces.
5. Convert MCP items to the shared service DTO while enforcing project scope.
6. Run MCP tests and confirm they pass.

### Task 5: Send one batch request from the project popup

**Files:**
- Modify: `apps/workspace/src/api/types/generation.ts`
- Modify: `apps/workspace/src/domains/generation/api/generation.ts`
- Test: `apps/workspace/src/domains/generation/api/generation.test.ts`
- Modify: `apps/workspace/src/pages/ProjectOverview.tsx`
- Test: `apps/workspace/src/pages/ProjectOverview.test.tsx`
- Remove or retire: `apps/workspace/src/domains/documents/components/DocumentSectionBatchGenerationRunner.tsx`
- Remove or replace: `apps/workspace/src/domains/documents/components/DocumentSectionBatchGenerationRunner.test.tsx`

**Steps:**
1. Add failing API serialization and Project Overview tests asserting one `/generation/batches` request.
2. Run focused Vitest tests and confirm they fail.
3. Add frontend batch types and `sendGenerationBatch`.
4. Build image/video batch items from selected resources and shared popup settings.
5. Replace the client-side job runner with one awaited batch request and per-item status reconciliation.
6. Run focused tests and confirm they pass.

### Task 6: Update generation instructions and verify quality gates

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`

**Steps:**
1. Document when multiple targets should use `generate_media_batch` and how to poll returned task IDs.
2. Update instruction contract tests.
3. Run `gofmt` on changed Go files.
4. Run focused Go and Vitest suites.
5. Run `go test ./...` in `packages/mcp` and `services/server` where feasible.
6. Run workspace lint, format check, and build; report any unrelated pre-existing failures separately.
