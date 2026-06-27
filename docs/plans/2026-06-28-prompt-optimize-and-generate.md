# Prompt Optimize And Generate Plan

## Goal

Create a dedicated backend API for `优化并生成`: submit once from the frontend, let the backend first optimize the current prompt through a text route, then generate media with the optimized prompt.

## Final Direction

- New endpoint: `POST /api/v1/generation/sessions/{sessionId}/messages/optimize-and-generate`
- Request body reuses the existing generation message payload plus `promptOptimization`.
- Backend persists two toolbox records:
  - a `text` generation task for prompt optimization
  - an `image`/media generation task using the optimized prompt
- Media generation still reuses the existing `CreateGenerationMessage` path after prompt optimization succeeds.
- Frontend keeps the existing `submitGeneration({ promptOptimization })` call shape, but the hook routes it to the new endpoint.

## Acceptance Checks

- `优化并生成` no longer calls the regular generation message endpoint.
- The text optimization task is stored in the toolbox text history.
- The image generation task is stored in the toolbox image history with the optimized prompt.
- The previous frontend-only optimization template loading state does not block backend optimized generation.
- Missing text route still disables/no-ops optimized generation.
