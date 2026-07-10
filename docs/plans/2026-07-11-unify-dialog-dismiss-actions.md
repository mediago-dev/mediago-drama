# Simplify Dialog Stacking and Unify Dismiss Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 删除无效的自定义弹窗层级注册表，恢复 Radix/shadcn 原生 Portal，并用一个共享关闭动作封装阻止上层关闭时的 `pointerdown` 误伤下层。

**Architecture:** 弹窗业务组件继续独立拥有自己的 `open` 状态；Radix Portal 按打开顺序负责绘制层级。所有会关闭当前模态窗的鼠标按钮统一通过共享 `DialogClose` 或 `DialogDismissButton`，在保留调用方事件的同时停止 `pointerdown` 向底层 DismissableLayer 传播。

**Tech Stack:** React 19, TypeScript, Radix Dialog/AlertDialog, shadcn-style components, Vitest, Testing Library

---

### Task 1: Remove the custom layer registry

**Files:**

- Delete: `apps/workspace/src/shared/components/ui/dialog-layer.ts`
- Delete: `apps/workspace/src/shared/components/ui/dialog-layer.test.tsx`
- Restore native Portal implementations in:
  - `apps/workspace/src/domains/documents/components/GenerationModalShell.tsx`
  - `apps/workspace/src/domains/generation/components/GenerationDialogShell.tsx`
  - `apps/workspace/src/shared/components/ui/sheet.tsx`
  - `apps/workspace/src/shared/components/ui/alert-dialog.tsx`
  - `apps/workspace/src/domains/generation/components/ImageStickerEditorDialogView.tsx`
  - `apps/workspace/src/domains/generation/components/MediaGenerationHistory.tsx`
  - `apps/workspace/src/pages/ProjectOverview.tsx`

**Step 1:** Restore the files above to their `10103bf4` Radix implementations and remove all `useDialogLayer` imports and `data-dialog-layer-*` assertions.

**Step 2:** Keep the effective behavior tests: two dialogs remain `data-state="open"`, the lower DOM instance is unchanged, and one Escape closes only the top dialog.

**Step 3:** Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/documents/components/GenerationModalShell.test.tsx src/pages/ProjectOverview.test.tsx
```

Expected: native Portal stacking tests pass without the layer store.

---

### Task 2: Add shared dialog-dismiss actions

**Files:**

- Create: `apps/workspace/src/shared/components/ui/dialog-dismiss.tsx`
- Create: `apps/workspace/src/shared/components/ui/dialog-dismiss.test.tsx`

**Step 1:** Write failing tests proving that the caller's `onPointerDown` still runs, the event does not reach an ancestor/document listener, and `click` still runs.

**Step 2:** Implement:

- `DialogClose`: a Radix `Dialog.Close` wrapper that composes `onPointerDown` and stops propagation.
- `DialogDismissButton`: a local `Button` wrapper for cancel/confirm/submit actions that close controlled dialogs.
- `isolateDialogDismissPointerDown`: the shared composition helper used by AlertDialog and Sheet wrappers.

**Step 3:** Run:

```bash
pnpm exec vitest run src/shared/components/ui/dialog-dismiss.test.tsx
```

Expected: PASS.

---

### Task 3: Migrate shared and nested dismiss actions

**Files:**

- Modify shared primitives:
  - `apps/workspace/src/shared/components/ui/alert-dialog.tsx`
  - `apps/workspace/src/shared/components/ui/sheet.tsx`
- Modify generation flows:
  - `apps/workspace/src/domains/documents/components/GenerationModalShell.tsx`
  - `apps/workspace/src/domains/generation/components/GenerationDialogShell.tsx`
  - `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.tsx`
  - `apps/workspace/src/domains/generation/components/MaterialLibraryImportDialog.tsx`
  - `apps/workspace/src/shared/components/generation-dialogs/AudioReferenceSelectionPanel.tsx`
- Replace direct `DialogPrimitive.Close` usage in preview/editor/settings dialogs with the shared `DialogClose` wrapper.

**Step 1:** Make `AlertDialogAction`, `AlertDialogCancel`, and `SheetClose` compose the shared pointer isolation automatically.

**Step 2:** Use `DialogDismissButton` for synchronous cancel/confirm/generate actions in nested generation dialogs.

**Step 3:** Replace all direct Radix close controls with `DialogClose` so future close icons inherit the same behavior.

**Step 4:** Add regression tests for header close, batch cancel/generate, material-library cancel/confirm, audio cancel/confirm, AlertDialog actions, and SheetClose.

---

### Task 4: Verify behavior and repository quality

**Step 1:** Run focused modal tests.

**Step 2:** Run all workspace gates:

```bash
pnpm test
pnpm lint
pnpm format
pnpm build
```

Expected: all commands exit 0.

**Step 3:** In the real overview page, verify:

- opening a generation dialog leaves the lower list `open`;
- closing the upper header only reveals the same lower instance;
- canceling batch settings leaves the lower list open;
- do not submit paid generation during browser verification.

**Step 4:** Commit the cleanup and unified dismiss behavior without rewriting existing history.
