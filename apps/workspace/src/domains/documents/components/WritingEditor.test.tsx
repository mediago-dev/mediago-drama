import type React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
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
		onSectionGenerate?: (section: MarkdownSectionContext, kind?: "image") => void;
		selectedSectionImageAssets?: Array<{ id: string; resourceId?: string; url?: string }>;
		value?: string;
	},
	mentionPopoverProps: null as null | { projectId?: string },
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
			return <div className="tiptap-content" data-testid="markdown-editor" />;
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
	DocumentMentionHoverPopover: (props: { children: React.ReactNode; projectId?: string }) => {
		testState.mentionPopoverProps = props;
		return <>{props.children}</>;
	},
}));

vi.mock("@/domains/documents/components/DocumentHistoryPanel", () => ({
	DocumentHistoryPanel: () => null,
}));

vi.mock("@/domains/documents/components/SelectionBubble", () => ({
	SelectionBubble: () => null,
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

	it("passes selected section images as editor display data without changing markdown value", async () => {
		const document = makeDocument();
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
				{
					assetIndex: 0,
					id: "other-doc-image",
					kind: "image",
					resourceId: "section_visual",
					resourceType: "storyboard",
					sourceDocumentId: "other-doc",
					title: "其他文档图",
					url: "/api/v1/media-assets/other-doc-image/content",
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

		await waitFor(() =>
			expect(testState.markdownEditorProps?.selectedSectionImageAssets).toEqual([
				expect.objectContaining({
					id: "selected-image",
					resourceId: "section_visual",
					url: "/api/v1/media-assets/selected-image/content",
				}),
			]),
		);
		expect(testState.markdownEditorProps?.value).toBe(document.content);
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
});
