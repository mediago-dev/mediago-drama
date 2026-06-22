import { cleanup, render } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import { createSectionBlockId } from "@/domains/documents/lib/sections";
import { useDocumentsStore, type MarkdownDocument } from "@/domains/documents/stores";
import type { MediaGenerationWorkspaceProps } from "@/domains/generation/components/MediaGenerationWorkspace";
import { EpisodeVideoGenerationDialog } from "./EpisodeVideoGenerationDialog";

const mocks = vi.hoisted(() => ({
	getProjects: vi.fn(),
	MediaGenerationWorkspace: vi.fn(() => null),
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: mocks.getProjects,
	projectsKey: "/projects",
}));

vi.mock("@/domains/generation/components/MediaGenerationWorkspace", () => ({
	MediaGenerationWorkspace: mocks.MediaGenerationWorkspace,
}));

describe("EpisodeVideoGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("passes a document notification target to video generation requests", () => {
		mocks.getProjects.mockResolvedValue({
			projects: [{ id: "project-a", name: "项目 A" }],
		});
		const videoTrack = sampleEpisode.tracks.find((track) => track.type === "video");
		const selectedClip = videoTrack?.clips[1] ?? null;

		render(
			<EpisodeVideoGenerationDialog
				documentId="doc-a"
				documentTitle="第一集分镜"
				episode={sampleEpisode}
				open
				projectId="project-a"
				selectedClip={selectedClip}
				selectedVideoUrl={null}
				onGeneratedVideoReady={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		const workspaceCalls = mocks.MediaGenerationWorkspace.mock.calls as unknown as Array<
			[Record<string, unknown>]
		>;
		const workspaceProps = workspaceCalls.at(-1)?.[0];

		expect(workspaceProps).toMatchObject({
			kind: "video",
			modelPreferenceScopeId: "agent",
			viewMode: "history",
			notificationTarget: {
				kind: "document-section",
				projectId: "project-a",
				documentId: "doc-a",
				documentTitle: "第一集分镜",
				section: {
					blockId: `episode-video:${sampleEpisode.id}:${selectedClip?.id}`,
					documentId: "doc-a",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: selectedClip?.title,
					plainText: selectedClip?.content,
					prompt: expect.stringContaining(selectedClip?.prompt ?? ""),
				},
			},
		});
		expect(workspaceProps?.initialPrompt).toContain(`## ${selectedClip?.title}`);
		expect(workspaceProps?.initialPrompt).toContain(selectedClip?.prompt ?? "");
		expect(workspaceProps?.initialPrompt).not.toContain("画面内容：");
		expect(workspaceProps?.initialPrompt).not.toContain("要求：");
	});

	it("uses source markdown and mention references like image generation", () => {
		mocks.getProjects.mockResolvedValue({ projects: [] });
		const onOpenReferenceGeneration = vi.fn();
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [
				baseDocument({
					id: "story-doc",
					category: "storyboard",
					title: "第一集分镜",
					content: [
						"# 第一集",
						"",
						"## 第 01 组",
						"",
						"**动作：** 沈阔 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character) 从水中下沉。",
						"",
						"**引用资源**：角色 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character)",
						"",
						"- 镜头：低角度跟拍",
						"",
						"### 标志性细节",
						"",
						"水泡从口鼻快速上浮。",
						"",
						"## 第 02 组",
						"",
						"动作：他猛然睁眼。",
					].join("\n"),
				}),
				baseDocument({
					id: "character-doc",
					category: "character",
					title: "沈阔",
					content:
						"<!-- section-id: section_character -->\n# 沈阔（普通状态）\n\n23 岁男性。\n\n![沈阔图](</api/media/assets/ref-a/content>)",
				}),
			],
		});
		const selectedClip = {
			id: "video-0-section",
			title: "第 01 组",
			start: 0,
			end: 4,
			content: "动作：沈阔 从水中下沉。",
			status: "draft" as const,
			prompt: "动作：沈阔 从水中下沉。",
		};

		render(
			<EpisodeVideoGenerationDialog
				documentId="story-doc"
				documentTitle="第一集分镜"
				episode={{
					...sampleEpisode,
					id: "episode-story-doc",
					title: "第一集",
				}}
				open
				projectId="project-a"
				selectedClip={selectedClip}
				selectedVideoUrl={null}
				onGeneratedVideoReady={vi.fn()}
				onOpenChange={vi.fn()}
				onOpenReferenceGeneration={onOpenReferenceGeneration}
			/>,
		);

		const workspaceProps = lastWorkspaceProps();
		const storyboardSectionBlockId = createSectionBlockId("story-doc", 2, 1, "第 01 组");
		expect(workspaceProps?.initialPrompt).toContain("## 第 01 组");
		expect(workspaceProps?.initialPrompt).toContain("**动作：**");
		expect(workspaceProps?.initialPrompt).toContain(
			"@[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character)",
		);
		expect(workspaceProps?.initialPrompt).toContain(
			"**引用资源**：角色 @[沈阔（普通状态）](mention://character-doc/section_character?kind=section&category=character)",
		);
		expect(workspaceProps?.initialPrompt).toContain("- 镜头：低角度跟拍");
		expect(workspaceProps?.initialPrompt).toContain("### 标志性细节");
		expect(workspaceProps?.initialPrompt).not.toContain("分组标题：");
		expect(workspaceProps?.initialPrompt).not.toContain("画面内容：");
		expect(workspaceProps?.initialPrompt).not.toContain("时间位置：");
		expect(workspaceProps?.initialPrompt).not.toContain("目标时长：");
		expect(workspaceProps?.initialPrompt).not.toContain("画幅比例：");
		expect(workspaceProps?.initialPrompt).not.toContain("要求：");
		expect(workspaceProps?.renderPromptEditor).toEqual(expect.any(Function));
		const promptEditor = workspaceProps?.renderPromptEditor?.({
			className: "",
			onChange: vi.fn(),
			placeholder: "",
			slashItems: [],
			value: workspaceProps.initialPrompt,
		});
		expect(isValidElement(promptEditor)).toBe(true);
		expect(
			(promptEditor as ReactElement<{ onGenerateReference?: unknown }>).props.onGenerateReference,
		).toBe(onOpenReferenceGeneration);

		const previewReferences = resolveReferencePreviewAssets(workspaceProps);
		const referenceAssetIds = resolveReferenceAssetIds(workspaceProps);
		const referenceBadges = resolveReferenceBadges(workspaceProps);

		expect(previewReferences).toHaveLength(1);
		expect(previewReferences[0]?.url).toBe("/api/media/assets/ref-a/content");
		expect(referenceAssetIds).toEqual(["ref-a"]);
		expect(referenceBadges[previewReferences[0]?.id ?? ""]).toBe("来自 @沈阔（普通状态）");
		expect(workspaceProps?.documentContext).toEqual({
			projectId: "project-a",
			documentId: "story-doc",
			sectionId: storyboardSectionBlockId,
		});
		expect(workspaceProps?.notificationTarget).toMatchObject({
			section: {
				blockId: storyboardSectionBlockId,
				headingText: "第 01 组",
				markdown: expect.stringContaining("**动作：**"),
				prompt: expect.stringContaining("### 标志性细节"),
			},
		});
	});
});

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

const lastWorkspaceProps = () => {
	const workspaceCalls = mocks.MediaGenerationWorkspace.mock.calls as unknown as Array<
		[MediaGenerationWorkspaceProps]
	>;
	return workspaceCalls.at(-1)?.[0] ?? null;
};

const resolveReferencePreviewAssets = (props: MediaGenerationWorkspaceProps | null) => {
	const value = props?.referencePreviewAssets;
	if (!value) return [];

	return typeof value === "function" ? value(props.initialPrompt) : value;
};

const resolveReferenceAssetIds = (props: MediaGenerationWorkspaceProps | null) => {
	const value = props?.extraReferenceAssetIds;
	if (!value) return [];

	return typeof value === "function" ? value(props.initialPrompt) : value;
};

const resolveReferenceBadges = (props: MediaGenerationWorkspaceProps | null) => {
	const value = props?.referenceBadges;
	if (!value) return {};

	return typeof value === "function" ? value(props.initialPrompt) : value;
};
