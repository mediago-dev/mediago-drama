import type React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
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
		onToggleImage?: (
			section: MarkdownSectionContext,
			asset: { kind: "image"; url: string },
			selected: boolean,
		) => void;
		open: boolean;
		section: MarkdownSectionContext | null;
	},
	mentionPopoverProps: null as null | { projectId?: string },
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
		testState.imageDialogProps = null;
		testState.mentionPopoverProps = null;
		testState.videoDialogProps = null;
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
});
