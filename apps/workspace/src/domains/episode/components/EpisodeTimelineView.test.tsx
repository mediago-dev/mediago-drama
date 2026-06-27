import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import useSWR from "swr";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { findEpisodeVideoClip } from "@/domains/episode/lib/filters";
import { type Episode, sampleEpisode } from "@/domains/episode/lib/sample";
import { useEpisodeStore } from "@/domains/episode/stores";
import { getMediaAssets } from "@/domains/workspace/api/media";
import {
	updateWorkspaceEpisode,
	workspaceEpisodePreviewStreamURL,
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
	previewRemoteControl: {
		pause: vi.fn(),
		play: vi.fn(),
	},
	previewNativeVideoPause: vi.fn(),
	previewNativeVideoPlay: vi.fn(() => Promise.resolve()),
	previewPlayerPause: vi.fn(() => Promise.resolve()),
	previewProvider: {
		play: vi.fn(() => Promise.resolve()),
	},
}));

vi.mock("swr", () => ({
	default: vi.fn(() => ({ data: undefined, mutate: vi.fn() })),
	mutate: vi.fn(),
}));

vi.mock("@/domains/workspace/api/media", () => ({
	getMediaAssets: vi.fn(async () => ({ assets: [] })),
	mediaAssetsKey: "/media-assets",
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceDocument: vi.fn(),
	createWorkspaceEventSource: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	getWorkspaceEpisode: vi.fn(async () => ({ episode: null })),
	getWorkspaceResolvedEpisode: vi.fn(async () => ({ episode: null })),
	getWorkspaceState: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
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
	workspaceResolvedEpisodeKey: (documentId: string, projectId?: string | null) => [
		"workspace-resolved-episode",
		projectId ?? "",
		documentId,
	],
	workspaceEpisodePreviewStreamURL: vi.fn(() => ""),
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/domains/generation/components/generatedResultActions", () => ({
	downloadGeneratedAssetToDirectory: vi.fn(),
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
		onPlayClip,
		onSeek,
		onTogglePlayback,
	}: {
		episode: Episode;
		onGenerateClip: (clipId: string) => void;
		onPlayClip: (clipId: string) => void;
		onSeek: (time: number) => void;
		onTogglePlayback: (event: React.MouseEvent<HTMLButtonElement>) => void;
	}) => {
		const videoClipId = episode.tracks.find((track) => track.type === "video")?.clips[0]?.id;
		return (
			<div data-testid="timeline-editor">
				<button
					type="button"
					disabled={!videoClipId}
					onClick={() => {
						if (videoClipId) onGenerateClip(videoClipId);
					}}
				>
					模拟请求视频生成
				</button>
				<button type="button" onClick={onTogglePlayback}>
					模拟播放片段条
				</button>
				<button
					type="button"
					disabled={!videoClipId}
					onClick={() => {
						if (videoClipId) onPlayClip(videoClipId);
					}}
				>
					模拟点击分镜播放
				</button>
				<button type="button" onClick={() => onSeek(1.25)}>
					模拟跳到后续进度
				</button>
			</div>
		);
	},
}));

vi.mock("@/domains/episode/components/EpisodePreviewPlayer", () => ({
	EpisodePreviewPlayer: ({
		currentTime,
		isPlaying,
		onPlayingChange,
		onTimeUpdate,
		playerRef,
	}: {
		currentTime?: number;
		isPlaying?: boolean;
		onPlayingChange?: (playing: boolean) => void;
		onTimeUpdate?: (currentTime: number) => void;
		playerRef?: React.Ref<unknown>;
	}) => {
		const video = document.createElement("video");
		Object.defineProperty(video, "pause", {
			configurable: true,
			value: fixtures.previewNativeVideoPause,
		});
		Object.defineProperty(video, "play", {
			configurable: true,
			value: fixtures.previewNativeVideoPlay,
		});
		const player = {
			currentTime: 0,
			pause: fixtures.previewPlayerPause,
			provider: fixtures.previewProvider,
			querySelector: (selector: string) => (selector === "video" ? video : null),
			remoteControl: fixtures.previewRemoteControl,
		};
		if (typeof playerRef === "function") {
			playerRef(player);
		} else if (playerRef) {
			playerRef.current = player;
		}
		return (
			<div
				data-testid="preview-player"
				data-current-time={currentTime}
				data-playing={isPlaying ? "true" : "false"}
			>
				<button type="button" onClick={() => onPlayingChange?.(true)}>
					模拟预览播放器播放
				</button>
				<button type="button" onClick={() => onTimeUpdate?.(1.25)}>
					模拟预览播放器时间更新
				</button>
			</div>
		);
	},
}));

vi.mock("@/domains/episode/components/EpisodeCompanionGenerationDialog", () => ({
	EpisodeCompanionGenerationDialog: () => null,
}));

vi.mock("@/domains/episode/components/EpisodeVideoGenerationDialog", () => ({
	buildEpisodeVideoContext: (
		_episode: Episode,
		selectedClip?: { id: string; title: string } | null,
	) => ({
		blockId: selectedClip?.id ?? "episode-video",
		headingLevel: 2,
		headingOccurrence: 1,
		headingText: selectedClip?.title ?? "分镜",
		plainText: selectedClip?.title ?? "分镜",
		prompt: selectedClip?.title ?? "分镜",
		sourceMarkdown: `## ${selectedClip?.title ?? "分镜"}`,
	}),
	buildEpisodeVideoReferenceInputs: () => ({ assetIds: [], urls: [] }),
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
	findEpisodeVideoSourceSection: () => null,
	firstVideoAssetSource: (assets: Array<{ kind: string; url?: string }>) =>
		assets.find((asset) => asset.kind === "video" && asset.url)?.url ?? "",
}));

vi.mock("@/shared/components/generation-dialogs/ImageGenerationDialog", () => ({
	ImageGenerationDialog: ({
		open,
		section,
		onToggleImage,
	}: {
		open: boolean;
		section: MarkdownSectionContext | null;
		onToggleImage?: (
			section: MarkdownSectionContext,
			asset: typeof fixtures.generatedAsset,
			selected: boolean,
		) => void;
	}) =>
		(() => {
			fixtures.imageDialogSection = open ? section : null;
			return open && section ? (
				<button
					type="button"
					onClick={() => onToggleImage?.(section, fixtures.generatedAsset, true)}
				>
					选择画布生成图片
				</button>
			) : null;
		})(),
}));

const LocationProbe = () => {
	const location = useLocation();
	return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

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
		fixtures.previewNativeVideoPause.mockReset();
		fixtures.previewNativeVideoPlay.mockReset();
		fixtures.previewRemoteControl.pause.mockReset();
		fixtures.previewRemoteControl.play.mockReset();
		fixtures.previewPlayerPause.mockReset();
		fixtures.previewProvider.play.mockReset();
		vi.mocked(useSWR).mockReset();
		vi.mocked(useSWR).mockReturnValue({ data: undefined, mutate: vi.fn() } as never);
		vi.mocked(getMediaAssets).mockReset();
		vi.mocked(getMediaAssets).mockResolvedValue({ assets: [] });
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReset();
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReturnValue("");
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

	it("returns to the project overview when opened from overview resources", async () => {
		render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/projects",
						search: "?projectId=project-a&documentId=story-doc&workbench=timeline",
						state: { projectView: "overview" },
					},
				]}
			>
				<Routes>
					<Route
						path="/projects"
						element={
							<>
								<EpisodeTimelineView documentId="story-doc" />
								<LocationProbe />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);

		screen.getByRole("button", { name: "返回概览" }).click();

		await waitFor(() => {
			expect(screen.getByTestId("location")).toHaveTextContent("/projects?projectId=project-a");
		});
	});

	it("starts preview playback from the timeline button using the native video element", async () => {
		const episodeWithVideo = sampleEpisodeWithReadyVideo();
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReturnValue(
			"/api/v1/projects/project-a/workspace/episodes/story-doc/preview.mp4",
		);
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						createdAt: "2026-06-22T00:00:00.000Z",
						documentId: "story-doc",
						episode: episodeWithVideo,
						projectId: "project-a",
						updatedAt: "2026-06-22T00:00:00.000Z",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			if (Array.isArray(key) && key[0] === "episode-media-assets") {
				return {
					data: {
						assets: [
							{
								createdAt: "2026-06-22T00:00:00.000Z",
								durationSeconds: 5,
								filename: "clip.mp4",
								id: "asset-a",
								kind: "video",
								mimeType: "video/mp4",
								posterUrl: "/api/v1/media-assets/asset-a/poster",
								size: 1024,
								source: "generation",
								updatedAt: "2026-06-22T00:00:00.000Z",
								url: "/api/v1/media-assets/asset-a/content",
							},
						],
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(workspaceEpisodePreviewStreamURL).toHaveBeenCalled();
		});

		screen.getByRole("button", { name: "模拟播放片段条" }).click();

		expect(fixtures.previewNativeVideoPlay).toHaveBeenCalledTimes(1);
		expect(fixtures.previewProvider.play).not.toHaveBeenCalled();
		expect(fixtures.previewRemoteControl.play).not.toHaveBeenCalled();
		expect(useEpisodeStore.getState().isPlaying).toBe(true);
	});

	it("jumps to a storyboard clip and starts playback when the clip is clicked", async () => {
		const episodeWithVideo = sampleEpisodeWithReadyVideo();
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReturnValue(
			"/api/v1/projects/project-a/workspace/episodes/story-doc/preview.mp4",
		);
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						createdAt: "2026-06-22T00:00:00.000Z",
						documentId: "story-doc",
						episode: episodeWithVideo,
						projectId: "project-a",
						updatedAt: "2026-06-22T00:00:00.000Z",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			if (Array.isArray(key) && key[0] === "episode-media-assets") {
				return {
					data: {
						assets: [
							{
								createdAt: "2026-06-22T00:00:00.000Z",
								durationSeconds: 5,
								filename: "clip.mp4",
								id: "asset-a",
								kind: "video",
								mimeType: "video/mp4",
								posterUrl: "/api/v1/media-assets/asset-a/poster",
								size: 1024,
								source: "generation",
								updatedAt: "2026-06-22T00:00:00.000Z",
								url: "/api/v1/media-assets/asset-a/content",
							},
						],
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(workspaceEpisodePreviewStreamURL).toHaveBeenCalled();
		});

		screen.getByRole("button", { name: "模拟点击分镜播放" }).click();

		expect(fixtures.previewNativeVideoPlay).toHaveBeenCalledTimes(1);
		expect(useEpisodeStore.getState().isPlaying).toBe(true);
		expect(useEpisodeStore.getState().selectedClipId).toBe(storyboardVideoClipId);
	});

	it("loads the document-derived timeline returned by the resolved episode endpoint", async () => {
		const resolvedEpisode: Episode = {
			aspectRatio: "16:9",
			duration: 30,
			id: "episode-story-doc",
			sections: [
				{
					end: 15,
					id: "section-0-01-00-07",
					start: 0,
					summary: "旧分镜内容",
					title: "第 01 组 总时长：00:07",
				},
				{
					end: 30,
					id: "section-1-02-00-05",
					start: 15,
					summary: "新增分镜内容",
					title: "第 02 组 总时长：00:05",
				},
			],
			title: "分镜脚本 第一章",
			tracks: [
				{
					clips: [
						{
							content: "旧分镜内容",
							end: 15,
							id: "video-0-01-00-07",
							start: 0,
							status: "ready",
							title: "第 01 组 总时长：00:07",
							videoUrl: "/api/v1/media-assets/persisted-video/content",
						},
						{
							content: "新增分镜内容",
							end: 30,
							id: "video-1-02-00-05",
							start: 15,
							status: "draft",
							title: "第 02 组 总时长：00:05",
						},
					],
					id: "track-video",
					label: "视频",
					type: "video",
				},
			],
		};
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						documentId: "story-doc",
						documentUpdatedAt: "2026-06-22T00:00:00.000Z",
						episode: resolvedEpisode,
						persistedUpdatedAt: "2026-06-22T00:00:00.000Z",
						projectId: "project-a",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			const videoClips =
				useEpisodeStore.getState().episode.tracks.find((track) => track.type === "video")?.clips ??
				[];
			expect(videoClips.map((clip) => clip.title)).toEqual([
				"第 01 组 总时长：00:07",
				"第 02 组 总时长：00:05",
			]);
			expect(videoClips[0]?.videoUrl).toBe("/api/v1/media-assets/persisted-video/content");
			expect(videoClips[1]?.videoUrl).toBeUndefined();
		});
	});

	it("starts a fresh preview stream from zero instead of seeking before playback", async () => {
		const episodeWithVideo = sampleEpisodeWithReadyVideo();
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReturnValue(
			"/api/v1/projects/project-a/workspace/episodes/story-doc/preview.mp4",
		);
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						createdAt: "2026-06-22T00:00:00.000Z",
						documentId: "story-doc",
						episode: episodeWithVideo,
						projectId: "project-a",
						updatedAt: "2026-06-22T00:00:00.000Z",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			if (Array.isArray(key) && key[0] === "episode-media-assets") {
				return {
					data: {
						assets: [
							{
								createdAt: "2026-06-22T00:00:00.000Z",
								durationSeconds: 5,
								filename: "clip.mp4",
								id: "asset-a",
								kind: "video",
								mimeType: "video/mp4",
								posterUrl: "/api/v1/media-assets/asset-a/poster",
								size: 1024,
								source: "generation",
								updatedAt: "2026-06-22T00:00:00.000Z",
								url: "/api/v1/media-assets/asset-a/content",
							},
						],
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(workspaceEpisodePreviewStreamURL).toHaveBeenCalled();
		});

		screen.getByRole("button", { name: "模拟跳到后续进度" }).click();
		await waitFor(() => {
			expect(useEpisodeStore.getState().currentTime).toBe(1.25);
		});

		screen.getByRole("button", { name: "模拟播放片段条" }).click();

		await waitFor(() => {
			expect(screen.getByTestId("preview-player")).toHaveAttribute("data-current-time", "0");
		});
	});

	it("keeps preview-player playback time active when playback starts from player controls", async () => {
		const episodeWithVideo = sampleEpisodeWithReadyVideo();
		vi.mocked(workspaceEpisodePreviewStreamURL).mockReturnValue(
			"/api/v1/projects/project-a/workspace/episodes/story-doc/preview.mp4",
		);
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						createdAt: "2026-06-22T00:00:00.000Z",
						documentId: "story-doc",
						episode: episodeWithVideo,
						projectId: "project-a",
						updatedAt: "2026-06-22T00:00:00.000Z",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			if (Array.isArray(key) && key[0] === "episode-media-assets") {
				return {
					data: {
						assets: [
							{
								createdAt: "2026-06-22T00:00:00.000Z",
								durationSeconds: 5,
								filename: "clip.mp4",
								id: "asset-a",
								kind: "video",
								mimeType: "video/mp4",
								posterUrl: "/api/v1/media-assets/asset-a/poster",
								size: 1024,
								source: "generation",
								updatedAt: "2026-06-22T00:00:00.000Z",
								url: "/api/v1/media-assets/asset-a/content",
							},
						],
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(workspaceEpisodePreviewStreamURL).toHaveBeenCalled();
		});

		screen.getByRole("button", { name: "模拟预览播放器播放" }).click();
		expect(useEpisodeStore.getState().isPlaying).toBe(true);

		screen.getByRole("button", { name: "模拟预览播放器时间更新" }).click();

		await waitFor(() => {
			expect(screen.getByTestId("preview-player")).toHaveAttribute("data-current-time", "1.25");
		});
	});

	it("persists videos synced from completed generation tasks before preview playback", async () => {
		const persistedEpisode = makeStoryboardEpisode();
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						createdAt: "2026-06-22T00:00:00.000Z",
						documentId: "story-doc",
						episode: persistedEpisode,
						projectId: "project-a",
						updatedAt: "2026-06-22T00:00:00.000Z",
						workspaceDir: "/workspace/project-a",
					},
					mutate: vi.fn(),
				} as never;
			}
			if (Array.isArray(key) && key[0] === "/generation/tasks") {
				return {
					data: {
						tasks: [
							{
								assets: [
									{
										kind: "video",
										posterUrl: "/api/v1/media-assets/generated-video/poster",
										url: "/api/v1/media-assets/generated-video/content",
									},
								],
								createdAt: "2026-06-22T00:00:00.000Z",
								documentId: "story-doc",
								kind: "video",
								sectionId: storyboardVideoClipId,
								status: "completed",
								updatedAt: "2026-06-22T00:00:01.000Z",
							},
						],
					},
					mutate: vi.fn(),
				} as never;
			}
			return { data: undefined, mutate: vi.fn() } as never;
		});

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-a&workbench=timeline"]}>
				<EpisodeTimelineView documentId="story-doc" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(updateWorkspaceEpisode).toHaveBeenCalledWith(
				"story-doc",
				expect.objectContaining({
					tracks: expect.arrayContaining([
						expect.objectContaining({
							type: "video",
							clips: expect.arrayContaining([
								expect.objectContaining({
									id: storyboardVideoClipId,
									status: "ready",
									videoUrl: "/api/v1/media-assets/generated-video/content",
								}),
							]),
						}),
					]),
				}),
				"project-a",
			);
		});
	});

	it("opens canvas reference generation without wiring document insertion", async () => {
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

		expect(
			useDocumentsStore.getState().documents.find((document) => document.id === "character-doc")
				?.content,
		).not.toContain("/api/v1/media-assets/generated-lin/content");
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

const sampleEpisodeWithReadyVideo = (): Episode => ({
	...makeStoryboardEpisode(),
	tracks: makeStoryboardEpisode().tracks.map((track) =>
		track.type === "video"
			? {
					...track,
					clips: track.clips.map((clip) => ({
						...clip,
						status: "ready" as const,
						videoUrl: "/api/v1/media-assets/asset-a/content",
					})),
				}
			: track,
	),
});

const storyboardVideoClipId = "video-0-01-00-07";

const makeStoryboardEpisode = (): Episode => ({
	aspectRatio: "16:9",
	duration: 15,
	id: "episode-story-doc",
	sections: [
		{
			end: 15,
			id: "section-0-01-00-07",
			start: 0,
			summary: "分镜内容。",
			title: "第 01 组 总时长：00:07",
		},
	],
	title: "分镜脚本 第一章",
	tracks: [
		{
			clips: [
				{
					content: "分镜内容。",
					end: 15,
					id: storyboardVideoClipId,
					start: 0,
					status: "draft",
					title: "第 01 组 总时长：00:07",
				},
			],
			id: "track-video",
			label: "视频",
			type: "video",
		},
	],
});
