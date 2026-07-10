# Radix Local Dialog Ownership Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the custom global modal-layer stack and preserve overview/media dialogs through local React ownership while Radix manages modal interaction and accessibility.

**Architecture:** `GenerationModalShell` returns to a thin Radix wrapper with no module-level registry. A reusable controlled media-dialog component owns only its direct reference-image child, while `ProjectOverview` owns the media request opened from its resource lists. The global host returns to one active request for genuinely global entry points such as notifications and editors.

**Tech Stack:** React 19, TypeScript, Zustand, Radix Dialog, Vitest, Testing Library

---

### Task 1: Restore the Radix shell

**Files:**
- Modify: `apps/workspace/src/domains/documents/components/GenerationModalShell.tsx`
- Modify: `apps/workspace/src/domains/documents/components/GenerationModalShell.test.tsx`

1. Remove the module-level layer snapshot, listener set, registration hook, generated z-indexes, and covered-layer dismissal guards.
2. Restore direct `onOpenChange`, Escape, focus-outside, and pointer-outside handling through Radix plus the existing PhotoView exception.
3. Remove tests that encode the custom layer registry.
4. Run `pnpm exec vitest run src/domains/documents/components/GenerationModalShell.test.tsx` and expect all remaining shell tests to pass.

### Task 2: Extract one controlled media dialog

**Files:**
- Create: `apps/workspace/src/domains/generation/components/MediaGenerationDialog.tsx`
- Modify: `apps/workspace/src/domains/generation/components/MediaGenerationDialogHost.tsx`
- Modify: `apps/workspace/src/domains/generation/components/MediaGenerationDialogHost.test.tsx`

1. Move request-specific rendering, generation status callbacks, and audio selection persistence into `MediaGenerationDialog`.
2. Keep at most one root request per component instance.
3. For video reference-image generation, store one local reference section and render the image dialog alongside the video dialog; closing it must leave the video dialog open.
4. Make the global host render one controlled component from `activeRequest`.
5. Replace global-stack tests with a local reference-child regression test.
6. Run the focused host tests and expect them to pass.

### Task 3: Give ProjectOverview local ownership

**Files:**
- Modify: `apps/workspace/src/pages/ProjectOverview.tsx`
- Modify: `apps/workspace/src/pages/ProjectOverview.test.tsx`

1. Add local `MediaGenerationDialogRequest | null` state.
2. Route resource image/audio and storyboard video actions into that local state instead of the global host.
3. Render `MediaGenerationDialog` as a sibling owned by `ProjectOverview`, independently of the list-dialog open state.
4. Add tests proving closing the child generation dialog does not close the resource list.
5. Run the focused overview tests and expect them to pass.

### Task 4: Remove the global request stack

**Files:**
- Modify: `apps/workspace/src/domains/generation/stores/media-generation.ts`
- Modify: `apps/workspace/src/domains/generation/stores/media-generation.test.ts`
- Modify: affected test reset files
- Delete: `docs/plans/2026-07-11-media-dialog-stack-design.md`
- Delete: `docs/plans/2026-07-11-media-dialog-stack.md`

1. Restore `activeRequest` as the only global dialog request and make `open`/`close` simple set operations.
2. Remove `dialogStack`, entry IDs, sequence counters, target deduplication, and stack-specific test resets.
3. Delete tests and design documents that describe the rejected global modal stack.
4. Run store, host, overview, editor, timeline, and status-hook test files.

### Task 5: Verify behavior and quality gates

1. Run `pnpm test` in `apps/workspace` and expect the full suite to pass.
2. Run `pnpm check` and expect lint and format checks to pass.
3. Run `pnpm build` and expect TypeScript and Vite production build to pass.
4. Run `git diff --check`.
5. In the local app, open the overview resource list, open image generation, close image generation, and confirm the resource list remains visible and interactive.
