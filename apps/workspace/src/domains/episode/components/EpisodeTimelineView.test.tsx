import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { findEpisodeVideoClip } from "@/domains/episode/lib/filters";
import { type Episode, sampleEpisode } from "@/domains/episode/lib/sample";
import { useEpisodeStore } from "@/domains/episode/stores";
import {
	updateWorkspaceDocumentSectionImage,
	updateWorkspaceEpisode,
} from "@/domains/workspace/api/workspace";
import { EpisodeTimelineView } from "./EpisodeTimelineView";

const fixtures = vi.hoisted(() => ({
	canvasSection: {
		blockId: "section_character_lin",
		documentId: "character-doc",
		headingLevel: 2,
		headingOccurrence: 1,
		headingText: "旧林书彤",
		markdown: ["## 旧林书彤", "", "旧形象定位。"].join("\n"),
		plainText: "旧林书彤\n旧形象定位。",
		prompt: "旧形象定位。",
	} satisfies MarkdownSectionContext,
	generatedAsset: {
		kind: "image" as const,
		title: "林书彤素材图",
		url: "/api/v1/media-assets/generated-lin/content",
	},
	imageDialogSection: null as MarkdownSectionContext | null,
}));

vi.mock("swr", () => ({
	default: vi.fn(() => ({ data: null, mutate: vi.fn() })),
}));

vi.mock("@/domains/workspace/api/media", () => ({
	getMediaAssets: vi.fn(async () => ({ assets: [] })),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceDocument: vi.fn(),
	createWorkspaceEventSource: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	getWorkspaceEpisode: vi.fn(async () => ({ episode: null })),
	getWorkspaceState: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceDocumentSectionImage: vi.fn(),
	updateWorkspaceDocumentSectionMedia: vi.fn(),
	updateWorkspaceDocumentSectionMention: vi.fn(),
	updateWorkspaceEpisode: vi.fn(async (documentId, episode, projectId) => ({
		createdAt: "2026-06-22T00:00:00.000Z",
		documentId,
		episode,
		projectId: projectId ?? "project-a",
		updatedAt: "2026-06-22T00:00:00.000Z",
		workspaceDir: "/workspace/project-a",
	})),
	updateWorkspaceState: vi.fn(),
	workspaceDocumentsChangedEventType: "workspace.documents.changed",
	workspaceEpisodeKey: (documentId: string, projectId?: string | null) => [
		"workspace-episode",
		projectId ?? "",
		documentId,
	],
	workspaceEpisodePreviewStreamURL: vi.fn(() => ""),
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

vi.mock("@/domains/workspace/lib/tauri-window-drag", () => ({
	useTauriWindowDrag: () => vi.fn(),
}));

vi.mock("@/domains/generation/components/generatedResultActions", () => ({
	pickGeneratedAssetSaveTarget: vi.fn(),
	saveGeneratedAssetToTarget: vi.fn(),
	saveGeneratedAssetToUserDirectory: vi.fn(),
}));

vi.mock("@/domains/episode/components/EpisodeCanvasView", () => ({
	EpisodeCanvasView: ({
		onOpenReferenceGeneration,
	}: {
		onOpenReferenceGeneration: (section: MarkdownSectionContext) => void;
	}) => (
		<button type="button" onClick={() => onOpenReferenceGeneration(fixtures.canvasSection)}>
			打开画布引用生成
		</button>
	),
}));

vi.mock("@/domains/episode/components/EpisodeTimelineEditor", () => ({
	EpisodeTimelineEditor: ({
		episode,
		onGenerateClip,
	}: {
		episode: Episode;
		onGenerateClip: (clipId: string) => void;
	}) => {
		const videoClipId = episode.tracks.find((track) => track.type === "video")?.clips[0]?.id;
		return (
			<button
				type="button"
				data-testid="timeline-editor"
				disabled={!videoClipId}
				onClick={() => {
					if (videoClipId) onGenerateClip(videoClipId);
				}}
			>
				模拟请求视频生成
			</button>
		);
	},
}));

vi.mock("@/domains/episode/components/EpisodePreviewPlayer", () => ({
	EpisodePreviewPlayer: () => <div data-testid="preview-player" />,
}));

vi.mock("@/domains/episode/components/EpisodeCompanionGenerationDialog", () => ({
	EpisodeCompanionGenerationDialog: () => null,
}));

vi.mock("@/domains/episode/components/EpisodeVideoGenerationDialog", () => ({
	EpisodeVideoGenerationDialog: ({
		onGeneratedVideoReady,
		selectedClip,
	}: {
		onGeneratedVideoReady?: (clipId: string, videoUrl: string | null) => void;
		selectedClip?: { id: string } | null;
	}) => (
		<button
			type="button"
			onClick={() =>
				onGeneratedVideoReady?.(
					selectedClip?.id ?? "missing-video-clip",
					"/api/v1/media-assets/generated-video/content",
				)
			}
		>
			模拟视频生成完成
		</button>
	),
}));

vi.mock("@/shared/components/generation-dialogs/ImageGenerationDialog", () => ({
	ImageGenerationDialog: ({
		open,
		section,
		onToggleImage,
	}: {
		open: boolean;
		section: MarkdownSectionContext | null;
		onToggleImage: (
			section: MarkdownSectionContext,
			asset: typeof fixtures.generatedAsset,
			selected: boolean,
		) => void;
	}) =>
		(() => {
			fixtures.imageDialogSection = open ? section : null;
			return open && section ? (
				<button type="button" onClick={() => onToggleImage(section, fixtures.generatedAsset, true)}>
					选择画布生成图片
				</button>
			) : null;
		})(),
}));

const makeDocument = (overrides: Partial<MarkdownDocument> = {}): MarkdownDocument => ({
	category: "storyboard",
	comments: [],
	content: "# 分镜脚本 第一章\n\n## 第 01 组 总时长：00:07\n\n分镜内容。",
	id: "story-doc",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: "分镜脚本 第一章",
	updatedAt: "2026-06-22T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
});

describe("EpisodeTimelineView canvas generation", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		fixtures.imageDialogSection = null;
		vi.mocked(updateWorkspaceEpisode).mockReset();
		vi.mocked(updateWorkspaceEpisode).mockImplementation(
			async (documentId, episode, projectId) => ({
				createdAt: "2026-06-22T00:00:00.000Z",
				documentId,
				episode,
				projectId: projectId ?? "project-a",
				updatedAt: "2026-06-22T00:00:00.000Z",
				workspaceDir: "/workspace/project-a",
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockReset();
		vi.mocked(updateWorkspaceDocumentSectionImage).mockImplementation(
			async (documentId, payload, projectId) => {
				const current = useDocumentsStore.getState();
				const nextDocuments = current.documents.map((document) =>
					document.id === documentId
						? {
								...document,
								content: [
									"# 角色册 第一章",
									"",
									"<!-- section-id: section_character_lin -->",
									"## 林书彤",
									"",
									"形象定位：21岁女大学生，身高163cm，48kg。",
									"",
									`![林书彤](<${payload.image.src}>)`,
								].join("\n"),
								isDirty: false,
								version: document.version + 1,
							}
						: document,
				);
				const savedDocument = nextDocuments.find((document) => document.id === documentId);
				if (!savedDocument) throw new Error("missing saved document");

				return {
					document: savedDocument,
					state: {
						workspaceDir: current.workspaceDir,
						projectId: projectId ?? current.projectId ?? undefined,
						documents: nextDocuments,
					},
				};
			},
		);
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [
				makeDocument(),
				makeDocument({
					category: "character",
					content: [
						"# 角色册 第一章",
						"",
						"<!-- section-id: section_character_lin -->",
						"## 林书彤",
						"",
						"形象定位：21岁女大学生，身高163cm，48kg。",
					].join("\n"),
					id: "character-doc",
					title: "角色册 第一章",
				}),
			],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
		useEpisodeStore.getState().setEpisode(sampleEpisode);
	});

	it("saves a selected canvas-generated reference image through the document section backend API", async () => {
		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=canvas"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		screen.getByRole("button", { name: "打开画布引用生成" }).click();
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "选择画布生成图片" })).toBeInTheDocument();
		});
		expect(fixtures.imageDialogSection?.headingText).toBe("林书彤");
		expect(fixtures.imageDialogSection?.prompt).toContain("## 林书彤");
		expect(fixtures.imageDialogSection?.prompt).toContain("形象定位：21岁女大学生");
		expect(fixtures.imageDialogSection?.prompt).not.toContain("旧形象定位");

		screen.getByRole("button", { name: "选择画布生成图片" }).click();

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionImage).toHaveBeenCalledWith(
				"character-doc",
				{
					sectionId: "section_character_lin",
					image: {
						src: "/api/v1/media-assets/generated-lin/content",
						title: "林书彤",
					},
					selected: true,
				},
				"project-a",
			);
		});
		expect(
			useDocumentsStore.getState().documents.find((document) => document.id === "character-doc")
				?.content,
		).toContain("![林书彤](</api/v1/media-assets/generated-lin/content>)");
	});

	it("rolls back a generated video clip when saving the episode fails", async () => {
		vi.mocked(updateWorkspaceEpisode).mockRejectedValueOnce(new Error("backend unavailable"));
		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=canvas"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		const videoClipId = useEpisodeStore
			.getState()
			.episode.tracks.find((track) => track.type === "video")?.clips[0]?.id;
		expect(videoClipId).toBeTruthy();
		screen.getByRole("button", { name: "模拟请求视频生成" }).click();
		screen.getByRole("button", { name: "模拟视频生成完成" }).click();

		await waitFor(() => {
			expect(updateWorkspaceEpisode).toHaveBeenCalled();
		});
		await waitFor(() => {
			const clip = findEpisodeVideoClip(useEpisodeStore.getState().episode, videoClipId ?? "");
			expect(clip?.videoUrl).toBeUndefined();
		});
	});
});
