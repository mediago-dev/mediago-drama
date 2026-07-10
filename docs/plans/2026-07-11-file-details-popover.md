# File Details Popover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the asset preview header's permanent save/download controls with a single more-actions button that opens file details, rename, and download actions.

**Architecture:** `ProjectAssetPreviewPane` remains the owner of rename and download mutations. The header becomes read-only and compact, while a controlled Radix Popover exposes technical metadata and contextual actions. Renaming uses an explicit local edit state with cancel/confirm controls; there is no permanent save button and no blur-based autosave.

**Tech Stack:** React 19, TypeScript, Radix Popover, Tailwind CSS v4, Vitest, Testing Library

---

### Task 1: Specify the new header and Popover interaction

**Files:**

- Modify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`
- Test: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

**Step 1: Replace direct-action expectations**

Assert that the default header renders the filename as text, omits the permanent `保存文件名` and `下载` buttons, and exposes one `更多文件操作` button.

**Step 2: Specify the details view**

Open the Popover and assert that it shows `文档详情`, filename, localized type, MIME type, size, `重命名`, and `下载文件`.

**Step 3: Specify rename behavior**

Click `重命名`, edit the `重命名文件` input, and click `确认重命名`. Assert the existing update API and store update behavior remain unchanged. Keep the failure test to ensure errors do not mutate the store.

**Step 4: Run the focused test and verify it fails**

Run: `pnpm exec vitest run src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

Expected: FAIL because the existing header still contains the filename input and permanent save/download buttons.

### Task 2: Implement the compact header and file details Popover

**Files:**

- Modify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.tsx`

**Step 1: Make the header read-only and remove duplicate metadata**

Render the filename as a truncated heading. Remove the secondary type/size line because the same information is available in the details Popover. Remove the header divider and rely on the existing layout gap plus the preview surface border for separation.

**Step 2: Add the more-actions trigger**

Use the shared Radix `Popover`, an outlined icon button, and `Ellipsis` from Lucide. Align the Popover to the end of the trigger and constrain its width for narrow workspaces.

**Step 3: Render file details and contextual actions**

Show filename, localized type, MIME, and size in a semantic description list. Add `重命名` and `下载文件` actions in the Popover footer.

**Step 4: Move renaming into the Popover**

Switch the filename row into an auto-focused input only after clicking `重命名`. Support explicit `取消` / `确认重命名`, Enter to confirm, and Escape to cancel. Reset drafts when the asset changes or the Popover closes.

**Step 5: Run focused tests**

Run: `pnpm exec vitest run src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

Expected: PASS.

### Task 3: Verify the interaction and product quality

**Files:**

- Verify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.tsx`
- Verify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

**Step 1: Run quality gates**

Run: `pnpm test && pnpm lint && pnpm format && pnpm build`

Expected: all commands exit 0.

**Step 2: Inspect the real page**

Open a project asset and verify the header contains only the more-actions button, the Popover aligns inside the viewport, download remains reachable, rename has clear confirm/cancel behavior, and the preview viewport still owns scrolling.
