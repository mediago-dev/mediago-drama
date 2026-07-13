# Select Generated Image by Asset ID Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist a manually selected historical generated image by its stable asset ID, while retaining task-slot fallback for legacy history.

**Architecture:** Expose `assetId` on the frontend generation asset contract and pass it as `mediaAssetId` when updating the selected resource. Selection persistence accepts either a stable asset ID or the legacy `taskId + slotIndex` source, and only reports success after the server mutation completes.

**Tech Stack:** React 19, TypeScript, Vitest, Go generation API.

---

### Task 1: Add regression coverage

**Files:**
- Modify: `apps/workspace/src/domains/generation/components/MediaGenerationWorkspace.test.tsx`

**Steps:**
1. Add a test where a historical image has `assetId` but no resolvable task slot.
2. Assert selecting it calls the selected-assets API with `mediaAssetId`.
3. Run the focused test and confirm it fails before implementation.

### Task 2: Carry and persist the stable asset ID

**Files:**
- Modify: `apps/workspace/src/api/types/generation.ts`
- Modify: `apps/workspace/src/domains/generation/components/MediaGenerationWorkspace.tsx`

**Steps:**
1. Add optional `assetId` to the frontend `GenerationAsset` contract.
2. Allow persistence when either `assetId` or a task-slot source is available.
3. Send `mediaAssetId` in the selection mutation and preserve task-slot fields when available.
4. Treat an unresolvable legacy selection as failure instead of silent success.

### Task 3: Verify

**Files:**
- Test: `apps/workspace/src/domains/generation/components/MediaGenerationWorkspace.test.tsx`

**Steps:**
1. Run the focused regression test.
2. Run the complete MediaGenerationWorkspace test file.
3. Run workspace lint, format check, and build.
