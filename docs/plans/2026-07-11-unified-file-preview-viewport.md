# Unified File Preview Viewport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the asset header fixed while every file type renders inside one bounded preview viewport, with long text scrolling only inside that viewport.

**Architecture:** `ProjectAssetPreviewPane` owns the full-height column and clips page-level overflow. Its header remains a non-scrolling flex item, while a labeled `section` fills the remaining height and becomes the shared host for `AssetPreviewBody`. Each preview variant continues to own its media-specific presentation, but all variants inherit the host's height constraint; text remains the only preview that scrolls internally.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest, Testing Library

---

### Task 1: Add the preview viewport regression test

**Files:**

- Modify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`
- Test: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

**Step 1: Write the failing test**

Render a text asset, find the `main` landmark and the region named `文件预览`, then assert that the outer pane uses `overflow-hidden`, the inner column uses `h-full min-h-0`, and the preview region uses `min-h-0 flex-1 overflow-hidden`.

**Step 2: Run the focused test to verify it fails**

Run: `pnpm test -- src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

Expected: FAIL because the current outer pane uses `overflow-y-auto`, the inner wrapper is only `min-h-full`, and the preview section has no accessible region label or overflow boundary.

### Task 2: Implement the unified preview viewport

**Files:**

- Modify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.tsx:98-165`

**Step 1: Bound the outer layout**

Change the `main` to clip overflow and change its centered child to `h-full min-h-0`. Mark the header as `shrink-0` so it stays visible.

**Step 2: Define the shared preview host**

Give the preview `section` `aria-label="文件预览"` and `overflow-hidden`, while preserving `flex min-h-0 flex-1 flex-col`. Keep every `AssetPreviewBody` variant inside this section.

**Step 3: Run the focused test to verify it passes**

Run: `pnpm test -- src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

Expected: PASS.

### Task 3: Preserve non-Markdown source text

**Files:**

- Modify: `apps/workspace/src/domains/documents/components/project-asset-preview.helpers.ts`
- Modify: `apps/workspace/src/domains/documents/components/project-asset-preview.components.tsx`
- Test: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

**Step 1: Add source-preservation boundary tests**

Render identical frontmatter-shaped text as `.txt` and `.md`. Assert that `.txt` has no `文档信息` section and that its preview `textContent` exactly equals the fetched source; assert that `.md` retains the collapsible metadata behavior.

**Step 2: Add explicit Markdown detection**

Treat `text/markdown`, `text/x-markdown`, `.md`, and `.markdown` as Markdown. All other text assets bypass `splitFrontmatter` and render the decoded source directly.

**Step 3: Run the focused test**

Run: `pnpm exec vitest run src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

Expected: all focused tests pass.

### Task 4: Verify quality and rendering

**Files:**

- Verify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.tsx`
- Verify: `apps/workspace/src/domains/documents/components/ProjectAssetPreviewPane.test.tsx`

**Step 1: Run static quality gates**

Run: `pnpm lint && pnpm format && pnpm build`

Expected: all commands exit 0.

**Step 2: Inspect the page in a browser**

Open a long text asset and confirm the file header remains fixed while wheel/trackpad scrolling moves only the text preview. Switch to image, video, and unsupported assets and confirm each remains contained inside the same preview region.
