import type React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { updateWorkspaceDocumentSectionImage } from "@/domains/workspace/api/workspace";
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
	imageDialogProps: null as null | {
		onToggleImage: (
			section: MarkdownSectionContext,
			asset: { kind: "image"; url: string },
			selected: boolean,
		) => void;
		open: boolean;
		section: MarkdownSectionContext | null;
	},
	videoDialogProps: null as null | {
		open: boolean;
		section: MarkdownSectionContext | null;
	},
}));

vi.mock("@/domains/documents/components/MarkdownHybridEditor", async () => {
	const React = await import("react");
	return {
		MarkdownHybridEditor: React.forwardRef((_props, ref) => {
			React.useImperativeHandle(ref, () => testState.editorHandle);
			return <div className="tiptap-content" data-testid="markdown-editor" />;
		}),
		prewarmMarkdownHybridEditorContent: vi.fn(),
	};
});

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceDocument: vi.fn(),
	createWorkspaceEventSource: vi.fn(),
	createWorkspaceFolder: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	deleteWorkspaceFolder: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceDocumentSectionImage: vi.fn(),
	updateWorkspaceDocumentSectionMedia: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
	updateWorkspaceState: vi.fn(),
	workspaceDocumentsChangedEventType: "workspace.documents.changed",
	workspaceDocumentsKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

vi.mock("@/domains/documents/components/DocumentMentionHoverPopover", () => ({
	DocumentMentionHoverPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/domains/documents/components/DocumentHistoryPanel", () => ({
	DocumentHistoryPanel: () => null,
}));

vi.mock("@/domains/documents/components/SelectionBubble", () => ({
	SelectionBubble: () => null,
}));

vi.mock("@/shared/components/generation-dialogs/ImageGenerationDialog", () => ({
	ImageGenerationDialog: (props: typeof testState.imageDialogProps) => {
		testState.imageDialogProps = props;
		return (
			<div
				data-open={props?.open ? "true" : "false"}
				data-section-id={props?.section?.blockId ?? ""}
				data-testid="image-generation-dialog"
			/>
		);
	},
}));

vi.mock("@/shared/components/generation-dialogs/VideoGenerationDialog", () => ({
	VideoGenerationDialog: (props: typeof testState.videoDialogProps) => {
		testState.videoDialogProps = props;
		return (
			<div
				data-open={props?.open ? "true" : "false"}
				data-section-id={props?.section?.blockId ?? ""}
				data-testid="video-generation-dialog"
			/>
		);
	},
}));

vi.mock("@/shared/components/generation-dialogs/AudioGenerationDialog", () => ({
	AudioGenerationDialog: () => null,
}));

const section: MarkdownSectionContext = {
	blockId: "section_visual",
	documentId: "story-doc",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "画面",
	markdown: "## 画面\n\n画面提示词。",
	plainText: "画面\n\n画面提示词。",
	prompt: "画面提示词。",
};

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
	afterEach(() => {
		cleanup();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
		useGenerationNotificationStore.getState().clearNotifications();
		vi.mocked(updateWorkspaceDocumentSectionImage).mockReset();
		testState.imageDialogProps = null;
		testState.videoDialogProps = null;
		Object.values(testState.editorHandle).forEach((value) => {
			if (typeof value === "function" && "mockClear" in value) value.mockClear();
		});
	});

	it("opens a completed generation notification once and writes the selected image to the active section", async () => {
		vi.mocked(updateWorkspaceDocumentSectionImage).mockImplementation(async (documentId) => {
			const current = useDocumentsStore.getState();
			const document = current.documents.find((item) => item.id === documentId);
			if (!document) throw new Error("missing test document");
			const savedDocument = {
				...document,
				content: [
					"# 第一集",
					"",
					"<!-- section-id: section_visual -->",
					"## 画面",
					"",
					"画面提示词。",
					"",
					"![画面](</api/v1/media-assets/generated/content>)",
				].join("\n"),
				isDirty: false,
				version: document.version + 1,
			};
			return {
				document: savedDocument,
				state: {
					documents: current.documents.map((item) =>
						item.id === documentId ? savedDocument : item,
					),
					projectId: current.projectId ?? undefined,
					workspaceDir: current.workspaceDir,
				},
			};
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument()],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
		const notification = useGenerationNotificationStore.getState().addNotification({
			assetCount: 1,
			sourceTaskId: "task-1",
			target: {
				kind: "document-section",
				documentId: "story-doc",
				documentTitle: "第一集",
				projectId: "project-a",
				section,
			},
		});
		useGenerationNotificationStore.getState().requestOpenNotification(notification.id);

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(testState.imageDialogProps?.open).toBe(true);
		});
		expect(testState.imageDialogProps?.section).toMatchObject({
			blockId: "section_visual",
			documentId: "story-doc",
		});
		expect(useGenerationNotificationStore.getState().pendingOpenRequest).toBeNull();

		const asset = {
			kind: "image" as const,
			url: "/api/v1/media-assets/generated/content",
		};
		testState.imageDialogProps?.onToggleImage(section, asset, true);

		expect("setSectionImage" in testState.editorHandle).toBe(false);
		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionImage).toHaveBeenCalledWith(
				"story-doc",
				{
					sectionId: "section_visual",
					image: {
						src: "/api/v1/media-assets/generated/content",
						title: "画面",
					},
					selected: true,
				},
				"project-a",
			);
			expect(useDocumentsStore.getState().documents[0]?.content).toContain(
				"![画面](</api/v1/media-assets/generated/content>)",
			);
		});
	});

	it("opens the video generation dialog for completed video notifications", async () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [makeDocument()],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
		const notification = useGenerationNotificationStore.getState().addNotification({
			assetCount: 1,
			kind: "video",
			sourceTaskId: "task-1",
			target: {
				kind: "document-section",
				documentId: "story-doc",
				documentTitle: "第一集",
				projectId: "project-a",
				section,
			},
		});
		useGenerationNotificationStore.getState().requestOpenNotification(notification.id);

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
				<WritingEditor />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(testState.videoDialogProps?.open).toBe(true);
		});
		expect(testState.videoDialogProps?.section).toMatchObject({
			blockId: "section_visual",
			documentId: "story-doc",
		});
		expect(testState.imageDialogProps?.open).toBe(false);
		expect(useGenerationNotificationStore.getState().pendingOpenRequest).toBeNull();
	});
});
