# Generation Batch Design

## Goal

Provide one server-side batch-generation contract shared by the project batch dialog and the generation MCP. A single batch request submits up to 50 media-generation items and returns one batch ID plus the ordered result of every child submission.

## Chosen architecture

The batch layer groups existing generation tasks instead of introducing a second execution engine. Every accepted item still runs through `GenerationService.CreateGenerationMessage` or `CreatePromptOptimizedGenerationMessage`, so provider routing, validation, asset caching, notifications, retries, polling, and result selection remain unchanged.

Each persisted generation task gains three optional fields: `batchId`, `batchIndex`, and `batchItemId`. The batch service generates a server-owned batch ID, applies it to every item, submits items with bounded concurrency, and returns results in input order. Existing task-list APIs gain an optional `batchId` filter, allowing a batch to be reconstructed from persisted child tasks without a separate batch table.

This is intentionally smaller than a durable batch queue. Pause, cancel, reprioritize, and crash-resumable pre-submission scheduling are outside the current requirement. Provider work remains asynchronous exactly as it is for single generation.

## HTTP contract

`POST /api/v1/generation/batches`

- Accepts optional shared `kind`, `sessionId`, `conversationTitle`, `projectId`, `scopeId`, and an ordered `items` array.
- When `sessionId` is provided, the service creates or reuses the named conversation once before submitting children, preserving the same project generation history used by single-item dialogs.
- Each item contains a caller-owned `id` and a normal generation `request`.
- Batch-level project/scope values fill missing item values.
- Rejects empty batches and batches over 50 items.
- Allows partial success. One invalid item does not cancel accepted siblings.
- Returns `id`, aggregate `status`, counts, and ordered item results.

`GET /api/v1/generation/batches/:batchId/tasks`

- Returns persisted child tasks in `batchIndex` order.
- Uses the same visibility and task records as the normal task API.

## MCP contract

Add `generate_media_batch`. Its item request uses the same generation fields as `generate_media`; its output mirrors the HTTP batch response. The returned child task IDs continue to work with `get_generation_task`, `poll_generation_task`, `retry_generation_task`, and `select_generation_asset`. `list_generation_tasks` accepts `batchId` for grouped status checks.

## Frontend flow

The batch settings dialog still owns shared route/parameter selection. On confirmation, Project Overview converts every selected resource or storyboard reel into a batch item and sends one HTTP request. It marks resources optimistically before submission, replaces local IDs with returned task IDs, marks only rejected items failed, and refreshes the existing image/video task cache.

The legacy React runner that mounted one generation workspace per item is removed from the active flow. This fixes the misleading `concurrency=1` behavior: the frontend no longer performs N single-task requests.

## Error and compatibility semantics

- Input order is stable in the response.
- Duplicate non-empty item IDs are rejected before submission.
- A batch with at least one accepted item returns HTTP 200; per-item failures are data in the response.
- A batch with structurally invalid input returns HTTP 400.
- Single-generation endpoints and MCP tools remain unchanged.
- Old task rows have empty batch fields and continue to deserialize normally.

## Verification

- Repository migration and batch filtering tests.
- Generation service tests for ordering, batch metadata, size validation, partial success, and prompt optimization routing.
- HTTP handler route/response tests.
- MCP registration, conversion, project scoping, and batch submission tests.
- Frontend API serialization tests and Project Overview tests proving one batch request replaces N single submissions.
