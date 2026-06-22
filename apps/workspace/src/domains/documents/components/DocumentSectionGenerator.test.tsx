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
		"## 第 01 组\n\n动作：沈阔 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character) 从水中下沉。",
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

	it("previews mention references while sending document context as the request source", () => {
		render(
			<DocumentSectionGenerator
				section={section}
				selectedAssetKeys={[]}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onToggleAsset={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("has-prompt-extras").textContent).toBe("false");
		expect(screen.getByTestId("reference-preview-count").textContent).toBe("1");
		expect(screen.getByTestId("reference-asset-ids").textContent).toBe("");
		expect(capturedWorkspaceProps?.documentContext).toEqual({
			projectId: "project-a",
			documentId: "story-doc",
			sectionId: "section_current",
		});
		expect(capturedWorkspaceProps?.extraPrompt).toBeUndefined();
		expect(capturedWorkspaceProps?.kind).toBe("image");
		expect(capturedWorkspaceProps?.onToggleAsset).toBeTruthy();
		expect(capturedWorkspaceProps?.projectId).toBe("project-a");
		expect(capturedWorkspaceProps?.selectedAssetResourceId).toBe("section_current");
		expect(capturedWorkspaceProps?.selectedAssetSourceDocumentId).toBe("story-doc");
		expect(capturedWorkspaceProps?.selectedAssetTitle).toBe("第 01 组");
	});

	it("passes selected document node images as reference shortcuts", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [
				baseDocument({
					id: "story-doc",
					title: "故事",
					content: [
						"## 第 01 组",
						"",
						"动作：沈阔入水。",
						"",
						"![第 01 组](</api/media/assets/scene-a/content>)",
						"",
						"## 第 02 组",
						"",
						"动作：林夜回头。",
						"",
						"![第 02 组](</api/media/assets/scene-b/content>)",
					].join("\n"),
				}),
			],
		});

		render(
			<DocumentSectionGenerator
				section={section}
				selectedAssetKeys={[]}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onToggleAsset={vi.fn()}
			/>,
		);

		const group = capturedWorkspaceProps?.referenceShortcutGroups?.[0];
		expect(group?.title).toBe("已选节点图片");
		expect(group?.items.map((item) => item.title)).toEqual(["第 01 组", "第 02 组"]);
		expect(group?.items.map((item) => item.subtitle)).toEqual(["第 01 组", "第 02 组"]);
	});

	it("opens audio generation with section asset selection", () => {
		render(
			<DocumentSectionGenerator
				kind="audio"
				section={section}
				selectedAssetKeys={["audio:existing"]}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onToggleAsset={vi.fn()}
			/>,
		);

		expect(capturedWorkspaceProps?.kind).toBe("audio");
		expect(capturedWorkspaceProps?.submitLabel).toBe("生成语音");
		expect(capturedWorkspaceProps?.selectedAssetKeys).toEqual(["audio:existing"]);
		expect(capturedWorkspaceProps?.selectedAssetTitle).toBe("第 01 组");
		expect(capturedWorkspaceProps?.onToggleAsset).toBeTruthy();
		expect(capturedWorkspaceProps?.historyScopeId).toContain(":audio");
	});

	it("opens video generation with section asset selection", () => {
		render(
			<DocumentSectionGenerator
				kind="video"
				section={section}
				selectedAssetKeys={["video:existing"]}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onToggleAsset={vi.fn()}
			/>,
		);

		expect(capturedWorkspaceProps?.kind).toBe("video");
		expect(capturedWorkspaceProps?.submitLabel).toBe("生成视频");
		expect(capturedWorkspaceProps?.selectedAssetKeys).toEqual(["video:existing"]);
		expect(capturedWorkspaceProps?.selectedAssetTitle).toBe("第 01 组");
		expect(capturedWorkspaceProps?.onToggleAsset).toBeTruthy();
		expect(capturedWorkspaceProps?.historyScopeId).toContain(":video");
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
