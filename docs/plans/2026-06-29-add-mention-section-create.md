# Mention Section Quick Create Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `@` 文档候选菜单的每个文档分组底部提供“新增角色 / 新增场景 / 新增道具”等入口，用户输入名称并确认后，把 `## 名称` 追加到目标文档末尾，并把新建节点作为当前 `@` 提及插入。

**Architecture:** 保持现有 TipTap Mention 扩展和 Zustand 文档保存链路不变。新增一个小型 callable 输入弹窗，一个纯函数工具负责标题规范化与 Markdown 追加，`mention-suggestion.ts` 只负责菜单渲染、触发弹窗、调用 `updateDocumentContent` 和执行当前 mention command。

**Tech Stack:** React 19, TypeScript, TipTap Mention/Suggestion, Zustand, react-call, Radix AlertDialog, Vitest + Testing Library.

---

## Current Context

- `apps/workspace/src/domains/documents/lib/mention-suggestion.ts` 渲染截图里的两栏 `@` 菜单：左栏是文档分组，右栏是文档和 H2/H3 节点。
- `apps/workspace/src/domains/documents/components/extensions/document-mention.ts` 使用 `createMentionSuggestion()`，无需改 TipTap schema。
- `apps/workspace/src/domains/documents/components/WritingEditor.tsx` 把 `DocumentMention` 作为 `writingEditorExtraExtensions` 传入主编辑器。
- `apps/workspace/src/domains/documents/stores/document-actions.ts` 已有 `updateDocumentContent(id, content)`，会做乐观更新、版本递增、后端落库和失败回滚。
- `apps/workspace/src/shared/components/callable/DialogCallHost.tsx` 挂载全局 callable 弹窗，`NewDocumentDialog.tsx` 是现成模式。

## Product Decisions

- 按目标文档的 `category` 决定按钮文案：`character -> 新增角色`，`scene -> 新增场景`，`prop -> 新增道具`，`storyboard -> 新增分镜`，`screenplay -> 新增剧本`，`reference -> 新增资料`。
- “新增 xx”只出现在右侧当前文档分组底部；素材分组不显示。
- 确认后追加二级标题：`## 用户输入名称`。
- 确认后自动把刚创建的 section mention 插到当前 `@` 触发位置，避免用户还要重新打开菜单。
- MVP 只校验非空名称；同名 H2 暂不拦截，现有 section occurrence 逻辑可以产生稳定 block id。

### Task 1: Add Markdown Append Helpers

**Files:**
- Create: `apps/workspace/src/domains/documents/lib/mention-section-create.ts`
- Test: `apps/workspace/src/domains/documents/lib/mention-section-create.test.ts`

**Step 1: Write the failing tests**

Cover:
- `character` returns `新增角色`; `scene` returns `新增场景`; unknown/fallback returns `新增节点`.
- Input title trims whitespace, collapses line breaks, strips leading Markdown heading markers.
- Empty input normalizes to `""`.
- Appending to non-empty content produces exactly one blank line before the new H2.
- Appending to empty content produces `## 标题\n`.

Example test shape:

```ts
import { describe, expect, it } from "vitest";
import {
	appendSecondLevelHeading,
	mentionCreateLabelForCategory,
	normalizeMentionSectionTitle,
} from "./mention-section-create";

describe("mention section create helpers", () => {
	it("labels creation actions by document category", () => {
		expect(mentionCreateLabelForCategory("character")).toBe("新增角色");
		expect(mentionCreateLabelForCategory("scene")).toBe("新增场景");
		expect(mentionCreateLabelForCategory(undefined)).toBe("新增节点");
	});

	it("normalizes user-provided section names", () => {
		expect(normalizeMentionSectionTitle("  ## 顾依依\n十年前  ")).toBe("顾依依 十年前");
		expect(normalizeMentionSectionTitle(" \n ")).toBe("");
	});

	it("appends a level-2 heading at the end of markdown content", () => {
		expect(appendSecondLevelHeading("# 角色设定\n\n## 李虎\n正文", "顾依依")).toBe(
			"# 角色设定\n\n## 李虎\n正文\n\n## 顾依依\n",
		);
		expect(appendSecondLevelHeading("", "顾依依")).toBe("## 顾依依\n");
	});
});
```

**Step 2: Run the helper test to verify it fails**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/lib/mention-section-create.test.ts
```

Expected: FAIL because the helper file does not exist.

**Step 3: Implement the helpers**

Suggested implementation:

```ts
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import type { DocumentCategory } from "@/domains/documents/stores";

export const mentionCreateLabelForCategory = (category?: DocumentCategory) => {
	const label = category ? documentCategoryDescriptorMap[category]?.label : undefined;
	return label ? `新增${label}` : "新增节点";
};

export const normalizeMentionSectionTitle = (value: string) =>
	value
		.replace(/\r?\n/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^#{1,6}\s*/, "")
		.trim();

export const appendSecondLevelHeading = (content: string, rawTitle: string) => {
	const title = normalizeMentionSectionTitle(rawTitle);
	if (!title) return content;
	const prefix = content.trimEnd();
	return prefix ? `${prefix}\n\n## ${title}\n` : `## ${title}\n`;
};
```

**Step 4: Run the helper test to verify it passes**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/lib/mention-section-create.test.ts
```

Expected: PASS.

### Task 2: Add Callable Name Input Dialog

**Files:**
- Create: `apps/workspace/src/domains/documents/components/MentionSectionCreateDialog.tsx`
- Modify: `apps/workspace/src/shared/components/callable/DialogCallHost.tsx`
- Test: `apps/workspace/src/domains/documents/components/MentionSectionCreateDialog.test.tsx`

**Step 1: Write the failing dialog test**

Cover:
- Dialog title shows `新增角色` or current create label.
- Confirm button is disabled when input is blank.
- Typing a name and clicking confirm resolves `{ title: "顾依依" }`.
- Escape/cancel resolves `null`.

**Step 2: Run the dialog test to verify it fails**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/components/MentionSectionCreateDialog.test.tsx
```

Expected: FAIL because the dialog component does not exist.

**Step 3: Implement the dialog**

Use the same callable pattern as `NewDocumentDialog.tsx`.

Key API:

```ts
export interface MentionSectionCreateDialogProps {
	createLabel: string;
	documentTitle: string;
}

export interface MentionSectionCreateDialogResult {
	title: string;
}

export const openMentionSectionCreateDialog = (props: MentionSectionCreateDialogProps) =>
	MentionSectionCreateDialog.call(props);
```

UI:
- `AlertDialogTitle`: `{createLabel}`
- `AlertDialogDescription`: `将在《{documentTitle}》末尾插入二级标题。`
- `Label`: `名称`
- `Input`: auto focus, placeholder `请输入名称`
- footer buttons: `取消`, `确认`

Use `normalizeMentionSectionTitle(input)` to compute the submit value and disable confirm while empty.

**Step 4: Mount the callable host**

Add this to `DialogCallHost.tsx`:

```tsx
import { MentionSectionCreateDialog } from "@/domains/documents/components/MentionSectionCreateDialog";

export const DialogCallHost: React.FC = () => (
	<>
		<ConfirmDialog />
		<NewDocumentDialog />
		<NewReferenceDocumentDialog />
		<GenerationConversationCreateDialog />
		<AgentProjectCreateDialog />
		<ProjectRenameDialog />
		<MentionSectionCreateDialog />
	</>
);
```

**Step 5: Run the dialog test to verify it passes**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/components/MentionSectionCreateDialog.test.tsx
```

Expected: PASS.

### Task 3: Wire The Create Action Into The Mention Menu

**Files:**
- Modify: `apps/workspace/src/domains/documents/lib/mention-suggestion.ts`
- Test: `apps/workspace/src/domains/documents/lib/mention-suggestion.test.ts`

**Step 1: Write the failing menu tests**

Add cases to `mention-suggestion.test.ts`:
- Rendering a character document shows a right-pane button named `新增角色`.
- Rendering a scene document shows `新增场景` when that group is active.
- Project asset group does not show a create button.
- Clicking the create button invokes a supplied `onCreateSection` callback with the active document group.

To keep the component test simple, extend `MentionListProps` with an optional testable callback:

```ts
onCreateSection?: (group: AgentMentionGroup) => void;
```

`createMentionSuggestion()` will pass the real async handler; component tests can pass a `vi.fn()`.

**Step 2: Run the menu test to verify it fails**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/lib/mention-suggestion.test.ts
```

Expected: FAIL because no create button exists.

**Step 3: Extend `AgentMentionGroup`**

Add fields:

```ts
interface AgentMentionGroup {
	category: DocumentCategory;
	documentId?: string;
	icon: LucideIcon;
	id: string;
	isAssetGroup?: boolean;
	items: AgentMentionItem[];
	label: string;
	meta: string;
}
```

In `createMentionGroups`, set:

```ts
documentId: item.kind === "asset" ? undefined : item.documentId,
isAssetGroup: item.kind === "asset",
```

**Step 4: Render the create action at the bottom of the active right pane**

Import:

```ts
import { Plus } from "lucide-react";
import { openMentionSectionCreateDialog } from "@/domains/documents/components/MentionSectionCreateDialog";
import {
	appendSecondLevelHeading,
	mentionCreateLabelForCategory,
} from "@/domains/documents/lib/mention-section-create";
```

In the right pane, after `activeItems.map(...)`, render:

```ts
!activeGroup?.isAssetGroup && activeGroup?.documentId
	? renderCreateSectionOption(activeGroup, selectedItemIndex === activeItems.length, {
			onCreateSection,
			setSelectedItemIndex,
		})
	: null
```

The button text should be `mentionCreateLabelForCategory(activeGroup.category)`.

**Step 5: Add keyboard support**

Treat `selectedItemIndex === activeItems.length` as the create button when the active group can create sections:
- Arrow up/down cycles across items plus create button.
- Enter on existing item calls `command(item)`.
- Enter on create calls `onCreateSection(activeGroup)`.

Keep Left/Right group navigation as-is and reset `selectedItemIndex` to 0 on group change.

**Step 6: Implement the real async create handler**

Inside `createMentionSuggestion`, pass an `onCreateSection` closure in `listProps(props)`.

Suggested flow:

```ts
const createSectionFromGroup = async (
	group: AgentMentionGroup,
	command: (item: AgentMentionItem) => void,
) => {
	if (!group.documentId || group.isAssetGroup) return;

	const document = useDocumentsStore
		.getState()
		.documents.find((item) => item.id === group.documentId);
	if (!document) return;

	const result = await openMentionSectionCreateDialog({
		createLabel: mentionCreateLabelForCategory(group.category),
		documentTitle: document.title,
	});
	const title = result?.title.trim();
	if (!title) return;

	const nextContent = appendSecondLevelHeading(document.content, title);
	if (nextContent === document.content) return;

	useDocumentsStore.getState().updateDocumentContent(document.id, nextContent);

	const createdItem = createMentionItems(title).find(
		(item) =>
			item.kind === "section" &&
			item.documentId === document.id &&
			normalizeHeadingText(item.title) === normalizeHeadingText(title),
	);
	if (createdItem) command(createdItem);
};
```

Important notes:
- Use `event.preventDefault()` on the create button `onMouseDown`, matching existing mention options.
- Do not create a new backend endpoint.
- Do not mutate `document.content` directly; always call `updateDocumentContent`.

**Step 7: Run the menu test to verify it passes**

Run:

```bash
pnpm --dir apps/workspace test src/domains/documents/lib/mention-suggestion.test.ts
```

Expected: PASS.

### Task 4: Style The Menu Footer

**Files:**
- Modify: `apps/workspace/src/styles/tiptap-mention.css`

**Step 1: Add footer/button styles**

Add classes:

```css
.agent-mention-create {
	position: sticky;
	bottom: 0;
	display: grid;
	width: 100%;
	min-height: 36px;
	grid-template-columns: 15px minmax(0, 1fr);
	align-items: center;
	gap: 6px;
	margin-top: 4px;
	border-top: var(--border-width-scale-sm) solid var(--border);
	border-radius: 7px;
	background: color-mix(in srgb, var(--popover) 86%, var(--muted));
	padding: 6px;
	text-align: left;
	transition:
		background-color 120ms ease,
		color 120ms ease;
}

.agent-mention-create[data-selected="true"] {
	background: var(--ide-list-active);
	color: var(--ide-list-active-foreground);
}

.agent-mention-create-icon {
	width: 15px;
	height: 15px;
	color: var(--muted-foreground);
}

.agent-mention-create[data-selected="true"] .agent-mention-create-icon {
	color: currentColor;
}
```

Keep all colors token-based; do not add hex/rgb colors.

**Step 2: Quick responsive check**

Verify the footer remains visible on desktop and mobile widths, and does not overlap existing options.

### Task 5: End-To-End Verification

**Files:**
- No new production files unless tests reveal a gap.

**Step 1: Run focused tests**

```bash
pnpm --dir apps/workspace test \
  src/domains/documents/lib/mention-section-create.test.ts \
  src/domains/documents/components/MentionSectionCreateDialog.test.tsx \
  src/domains/documents/lib/mention-suggestion.test.ts
```

Expected: PASS.

**Step 2: Run workspace quality gates**

```bash
pnpm --dir apps/workspace lint
pnpm --dir apps/workspace format
pnpm --dir apps/workspace build
```

Expected: all pass.

**Step 3: Manual QA**

1. Start the app:

```bash
pnpm workspace:dev
```

2. Open a project and focus the writing editor.
3. Type `@`.
4. Hover/select a role document in the left pane.
5. Confirm the right pane shows `新增角色` at the bottom.
6. Click `新增角色`.
7. Enter `顾依依` and confirm.
8. Verify the target role document content ends with:

```md
## 顾依依
```

9. Verify the current cursor receives an `@顾依依` section mention.
10. Repeat with a scene document and verify the button says `新增场景` and appends `## 场景名`.

## Rollback Plan

- Revert the new dialog file, helper file, mention menu changes, CSS additions, and tests.
- No migration or server rollback is required because the feature only uses existing document content updates.
