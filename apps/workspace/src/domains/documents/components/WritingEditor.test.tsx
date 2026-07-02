import type React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
	MarkdownSectionContext,
	SelectionCoords,
	SectionGenerateKind,
} from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import { WritingEditor } from "./WritingEditor";

const testState = vi.hoisted(() => ({
	editorHandle: {
		applyBlockDelta: vi.fn(() => true),
		commitBlockDelta: vi.fn(() => true),
		documentId: "story-doc",
		hasPendingBlockDelta: vi.fn(() => false),
		removeSectionImagePlaceholder: vi.fn(() => true),
		setSelection: vi.fn(() => true),
	},
	markdownEditorProps: null as null | {
		extraExtensions?: Array<{
			options?: { suggestion?: { items?: (props: { query: string }) => unknown[] } };
		}>;
		onSectionGenerate?: (section: MarkdownSectionContext, kind?: SectionGenerateKind) => void;
		onSelectionChange?: (value: string) => void;
		onSelectionCoordChange?: (coords: SelectionCoords | null) => void;
		selectedSectionImageAssets?: Array<{ id: string; resourceId?: string; url?: string }>;
		value?: string;
	},
	mentionPopoverProps: null as null | {
		projectId?: string;
		selectedGenerationAssets?: Array<Record<string, unknown>>;
	},
	selectionBubbleProps: null as null | {
		onComment: () => void;
		selectedText: string;
		top: number;
		x: number;
	},
}));

const generationApiMocks = vi.hoisted(() => ({
	getSelectedGenerationAssets: vi.fn(),
}));

vi.mock("@/domains/documents/components/MarkdownHybridEditor", async () => {
	const React = await import("react");
	return {
		MarkdownHybridEditor: React.forwardRef((props, ref) => {
			testState.markdownEditorProps = props;
			React.useImperativeHandle(ref, () => testState.editorHandle);
			return (
				<>
					<div className="tiptap-toolbar" data-testid="tiptap-toolbar" />
					<div className="tiptap-content" data-testid="markdown-editor" />
				</>
			);
		}),
		prewarmMarkdownHybridEditorContent: vi.fn(),
	};
});

vi.mock("@/domains/generation/api/generation", () => ({
	getSelectedGenerationAssets: generationApiMocks.getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey: (projectId?: string | null) => [
		"/generation/selected-assets",
		projectId?.trim() || "",
	],
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceDocument: vi.fn(),
	createWorkspaceEventSource: vi.fn(),
	createWorkspaceFolder: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	deleteWorkspaceFolder: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
	updateWorkspaceState: vi.fn(),
	workspaceDocumentsChangedEventType: "workspace.documents.changed",
	workspaceDocumentsKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

vi.mock("@/domains/documents/components/DocumentMentionHoverPopover", () => ({
	DocumentMentionHoverPopover: (props: {
		children: React.ReactNode;
		projectId?: string;
		selectedGenerationAssets?: Array<Record<string, unknown>>;
	}) => {
		testState.mentionPopoverProps = props;
		return <>{props.children}</>;
	},
}));

vi.mock("@/domains/documents/components/DocumentHistoryPanel", () => ({
	DocumentHistoryPanel: () => null,
}));

vi.mock("@/domains/documents/components/SelectionBubble", () => ({
	SelectionBubble: (props: {
		onComment: () => void;
		selectedText: string;
		top: number;
		x: number;
	}) => {
		testState.selectionBubbleProps = props;
		return (
			<button type="button" data-testid="selection-bubble" onClick={props.onComment}>
				{props.selectedText}
			</button>
		);
	},
}));

const makeDocument = (overrides: Partial<MarkdownDocument> = {}): MarkdownDocument => ({
	category: "storyboard",
	comments: [],
	content: [
		"# 第一集",
		"",
		"<!-- section-id: section_visual -->",
		"## 画面",
		"",
		"画面提示词。",
	].join("\n"),
	folderId: null,
	id: "story-doc",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	tags: [],
	title: "第一集",
	updatedAt: "2026-06-22T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
});

describe("WritingEditor", () => {
	beforeEach(() => {
		generationApiMocks.getSelectedGenerationAssets.mockResolvedValue({ assets: [] });
	});

	afterEach(() => {
		cleanup();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
		useMediaGenerationStore.setState({ activeRequest: null, optimisticStatuses: {} });
		testState.markdownEditorProps = null;
		testState.mentionPopoverProps = null;
		testState.selectionBubbleProps = null;
		generationApiMocks.getSelectedGenerationAssets.mockReset();
		Object.values(testState.editorHandle).forEach((value) => {
			if (typeof value === "function" && "mockClear" in value) value.mockClear();
		});
	});

	it("passes the project id to mention hover previews", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument()],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		expect(testState.mentionPopoverProps?.projectId).toBe("project-a");
	});

	it("does not feed selected section images into the document editor", async () => {
		const document = makeDocument();
		// Even when the project has selected image assets, the document editor no longer
		// renders per-section image previews — documents stay text-only.
		generationApiMocks.getSelectedGenerationAssets.mockResolvedValue({
			assets: [
				{
					assetIndex: 0,
					id: "selected-image",
					kind: "image",
					resourceId: "section_visual",
					resourceType: "storyboard",
					sourceDocumentId: "story-doc",
					title: "画面图",
					url: "/api/v1/media-assets/selected-image/content",
				},
			],
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [document],
			projectId: "project-selected-images",
			workspaceDir: "/workspace/project-selected-images",
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-selected-images"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		await waitFor(() => expect(testState.markdownEditorProps?.value).toBe(document.content));
		expect(testState.markdownEditorProps?.selectedSectionImageAssets).toBeUndefined();
	});

	it("positions the selection bubble in the editor scroll container", async () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument()],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});

		const { container } = render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);
		const main = container.querySelector("main");
		if (!main) throw new Error("missing editor scroll container");
		const toolbar = container.querySelector<HTMLElement>(".tiptap-toolbar");
		if (!toolbar) throw new Error("missing editor toolbar");

		Object.defineProperty(main, "clientHeight", { configurable: true, value: 480 });
		Object.defineProperty(main, "clientWidth", { configurable: true, value: 640 });
		Object.defineProperty(main, "scrollLeft", { configurable: true, value: 0 });
		Object.defineProperty(main, "scrollTop", { configurable: true, value: 320 });
		main.getBoundingClientRect = vi.fn(
			() =>
				({
					bottom: 580,
					height: 480,
					left: 20,
					right: 660,
					top: 100,
					width: 640,
					x: 20,
					y: 100,
					toJSON: () => ({}),
				}) as DOMRect,
		);
		toolbar.getBoundingClientRect = vi.fn(
			() =>
				({
					bottom: 132,
					height: 32,
					left: 20,
					right: 660,
					top: 100,
					width: 640,
					x: 20,
					y: 100,
					toJSON: () => ({}),
				}) as DOMRect,
		);

		act(() => {
			testState.markdownEditorProps?.onSelectionChange?.("画面提示词。");
			testState.markdownEditorProps?.onSelectionCoordChange?.({ bottom: 206, x: 260, y: 180 });
		});

		await waitFor(() => {
			expect(testState.selectionBubbleProps).toMatchObject({
				selectedText: "画面提示词。",
				top: 434,
				x: 240,
			});
		});
		const bubble = container.querySelector("[data-testid='selection-bubble']");
		expect(bubble).toBeTruthy();
		expect(main.contains(bubble)).toBe(true);
	});

	it("uses project selected assets for mention suggestion previews in the document editor", async () => {
		generationApiMocks.getSelectedGenerationAssets.mockResolvedValue({
			assets: [
				{
					assetIndex: 0,
					id: "selected-character-image",
					kind: "image",
					mediaAssetId: "selected-character-image",
					resourceId: "section_character",
					resourceType: "character",
					sourceDocumentId: "character-doc",
					title: "陈远参考图",
					url: "/api/v1/media-assets/selected-character-image/content",
				},
			],
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [
				makeDocument(),
				makeDocument({
					category: "character",
					content: "<!-- section-id: section_character -->\n# 陈远\n\n21 岁男大学生。",
					id: "character-doc",
					title: "角色",
				}),
			],
			projectId: "project-mention-preview",
			workspaceDir: "/workspace/project-mention-preview",
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-mention-preview"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(testState.mentionPopoverProps?.selectedGenerationAssets).toHaveLength(1),
		);
		const mentionExtension = testState.markdownEditorProps?.extraExtensions?.[0];
		const mentionItems = mentionExtension?.options?.suggestion?.items?.({ query: "陈远" }) ?? [];

		expect(mentionItems).toContainEqual(
			expect.objectContaining({
				kind: "section",
				previewUrl: "/api/v1/media-assets/selected-character-image/content",
				title: "陈远",
			}),
		);
	});

	it("opens the global generation dialog for the requested section and kind", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument()],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		act(() => {
			testState.markdownEditorProps?.onSectionGenerate?.(
				{
					blockId: "section_visual",
					documentId: "story-doc",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: "画面",
					markdown: "## 画面\n\n画面提示词。",
					plainText: "画面\n\n画面提示词。",
					prompt: "画面提示词。",
				},
				"image",
			);
		});

		expect(useMediaGenerationStore.getState().activeRequest).toMatchObject({
			kind: "image",
			projectId: "project-a",
			section: { blockId: "section_visual", documentId: "story-doc", headingText: "画面" },
		});
	});

	it("opens character audio selection with a resource type so it can sync to overview", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument({ category: "character" })],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		act(() => {
			testState.markdownEditorProps?.onSectionGenerate?.(
				{
					blockId: "section_visual",
					documentId: "story-doc",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: "画面",
					markdown: "## 画面\n\n画面提示词。",
					plainText: "画面\n\n画面提示词。",
					prompt: "画面提示词。",
				},
				"audio",
			);
		});

		expect(useMediaGenerationStore.getState().activeRequest).toMatchObject({
			kind: "audio",
			projectId: "project-a",
			selectedAssetResourceType: "character",
			section: { blockId: "section_visual", documentId: "story-doc", headingText: "画面" },
		});
	});
});
