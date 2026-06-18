import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaGenerationWorkspaceProps } from "@/domains/generation/components/MediaGenerationWorkspace";
import { DocumentSectionGenerator } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { MarkdownDocument } from "@/domains/documents/stores";

let capturedWorkspaceProps: MediaGenerationWorkspaceProps | null = null;

vi.mock("@/domains/generation/components/MediaGenerationWorkspace", () => ({
	MediaGenerationWorkspace: (props: MediaGenerationWorkspaceProps) => {
		capturedWorkspaceProps = props;
		const previewReferences = resolveReferencePreviewAssets(props);
		const referenceAssetIds = resolveReferenceAssetIds(props);

		return (
			<div>
				<div data-testid="has-prompt-extras">
					{props.promptExtras === undefined ? "false" : "true"}
				</div>
				<div data-testid="reference-preview-count">{previewReferences.length}</div>
				<div data-testid="reference-asset-ids">{referenceAssetIds.join(",")}</div>
			</div>
		);
	},
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: vi.fn(async () => ({ projects: [] })),
	projectsKey: "/projects",
}));

const baseDocument = (document: Partial<MarkdownDocument> & Pick<MarkdownDocument, "id">) => ({
	category: "screenplay" as const,
	comments: [],
	content: "",
	folderId: null,
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	tags: [],
	title: document.id,
	updatedAt: "2026-06-18T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...document,
	id: document.id,
});

const section: MarkdownSectionContext = {
	blockId: "section_current",
	documentId: "story-doc",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "第 01 组",
	markdown:
		"## 第 01 组\n\n动作：沈阔 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character) 从水中下沉。",
	plainText: "第 01 组\n\n动作：沈阔 从水中下沉。",
	prompt:
		"请根据下面这个标题区域生成可用于当前项目的视觉素材。\n标题：第 01 组\n\n正文：\n动作：沈阔 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character) 从水中下沉。",
};

describe("DocumentSectionGenerator", () => {
	beforeEach(() => {
		capturedWorkspaceProps = null;
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [
				baseDocument({
					id: "story-doc",
					title: "故事",
					content: section.markdown,
				}),
				baseDocument({
					category: "character",
					id: "character-doc",
					title: "沈阔",
					content:
						"<!-- section-id: section_character -->\n# 沈阔（普通状态）\n\n23 岁男性。\n\n![沈阔图](</api/media/assets/ref-a/content>)",
				}),
			],
		});
	});

	afterEach(() => {
		cleanup();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("defaults mention references to image inputs without rendering the reference card", () => {
		render(
			<DocumentSectionGenerator
				section={section}
				selectedAssetKeys={[]}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onToggleImage={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("has-prompt-extras").textContent).toBe("false");
		expect(screen.getByTestId("reference-preview-count").textContent).toBe("1");
		expect(screen.getByTestId("reference-asset-ids").textContent).toBe("ref-a");
		expect(capturedWorkspaceProps?.extraPrompt).toBeUndefined();
	});
});

const resolveReferencePreviewAssets = (props: MediaGenerationWorkspaceProps) => {
	const value = props.referencePreviewAssets;
	if (!value) return [];

	return typeof value === "function" ? value(props.initialPrompt) : value;
};

const resolveReferenceAssetIds = (props: MediaGenerationWorkspaceProps) => {
	const value = props.extraReferenceAssetIds;
	if (!value) return [];

	return typeof value === "function" ? value(props.initialPrompt) : value;
};
