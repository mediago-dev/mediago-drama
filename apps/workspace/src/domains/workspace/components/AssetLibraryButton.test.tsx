import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteSelectedGenerationAsset,
	getSelectedGenerationAssets,
	type SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { getProjects } from "@/domains/projects/api/projects";
import { getMediaAssets, type MediaAsset } from "@/domains/workspace/api/media";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";
import { AssetLibraryButton } from "./AssetLibraryButton";

vi.mock("@/components/AudioPlayer", () => ({
	AudioPlayer: ({ mimeType, src, title }: { mimeType?: string; src: string; title?: string }) => (
		<div
			data-testid="asset-audio-player"
			data-mime-type={mimeType}
			data-src={src}
			data-title={title}
		/>
	),
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({
		mimeType,
		poster,
		showTitleInControls,
		src,
		title,
	}: {
		mimeType?: string;
		poster?: string;
		showTitleInControls?: boolean;
		src: string;
		title?: string;
	}) => (
		<div
			data-testid="asset-video-player"
			data-mime-type={mimeType}
			data-poster={poster}
			data-show-title-in-controls={String(showTitleInControls)}
			data-src={src}
			data-title={title}
		/>
	),
}));

class TestPointerEvent extends MouseEvent {
	pointerId: number;
	pointerType: string;

	constructor(type: string, params: PointerEventInit = {}) {
		super(type, params);
		this.pointerId = params.pointerId ?? 1;
		this.pointerType = params.pointerType ?? "mouse";
	}
}

if (typeof window !== "undefined" && typeof window.PointerEvent !== "function") {
	Object.defineProperty(window, "PointerEvent", {
		value: TestPointerEvent,
		configurable: true,
	});
	Object.defineProperty(globalThis, "PointerEvent", {
		value: TestPointerEvent,
		configurable: true,
	});
}

if (typeof HTMLElement !== "undefined") {
	if (typeof HTMLElement.prototype.hasPointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
			value: () => false,
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.setPointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
			value: () => {},
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.releasePointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
			value: () => {},
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			value: () => {},
			configurable: true,
		});
	}
}

vi.mock("@/domains/workspace/api/media", () => ({
	deleteMediaAsset: vi.fn(),
	getMediaAssets: vi.fn(),
	mediaAssetsKey: "/media-assets",
	updateMediaAsset: vi.fn(),
	uploadMediaAsset: vi.fn(),
}));

vi.mock("@/domains/workspace/api/project-assets", () => ({
	deleteProjectAsset: vi.fn(),
	updateProjectAsset: vi.fn(),
	uploadProjectAsset: vi.fn(),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	getWorkspaceDocuments: vi.fn(),
	workspaceDocumentsKey: (projectId?: string | null) =>
		`/projects/${projectId ?? ""}/workspace/documents`,
}));

vi.mock("@/domains/generation/api/generation", () => ({
	deleteSelectedGenerationAsset: vi.fn(),
	getSelectedGenerationAssets: vi.fn(),
	selectedGenerationAssetsQueryKey: (projectId?: string | null) => [
		"/generation/selected-assets",
		projectId ?? "",
	],
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: vi.fn(),
	projectsKey: "/projects",
}));

describe("AssetLibraryButton", () => {
	beforeEach(() => {
		vi.mocked(getProjects).mockResolvedValue({
			databasePath: "/tmp/db.sqlite",
			projects: [
				workspaceProject({ id: "project-a", name: "项目甲" }),
				workspaceProject({ id: "project-b", name: "项目乙" }),
			],
			workspaceDir: "/tmp",
		});
		vi.mocked(getWorkspaceDocuments).mockResolvedValue(workspaceDocuments());
	});

	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("opens the global asset library outside a project", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [mediaAsset({ filename: "global-still.png", id: "global-media" })],
		});

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "全局素材库" })).toBeTruthy();
		expect((await screen.findAllByText("global-still.png")).length).toBeGreaterThan(0);
		expect(screen.queryByRole("combobox", { name: "来源" })).not.toBeInTheDocument();
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: undefined });
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		expect(getSelectedGenerationAssets).not.toHaveBeenCalled();
	});

	it("opens the project asset library without project document uploads", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [
				mediaAsset({
					filename: "hero-media.png",
					id: "hero-media",
					relativePath: "library/2026-06-21/asset-hero-media.png",
					url: "/api/v1/media-assets/hero-media/content",
				}),
			],
		});
		vi.mocked(getSelectedGenerationAssets).mockResolvedValue({
			assets: [
				selectedAsset({
					resourceType: "character",
					taskId: "task-1",
					url: "/api/v1/media-assets/hero-media/content",
				}),
			],
		});

		renderAssetLibraryButton("/projects?projectId=project-a");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "项目素材库" })).toBeTruthy();
		expect((await screen.findAllByText("hero-media.png")).length).toBeGreaterThan(0);
		expect(screen.getByRole("combobox", { name: "来源" })).toBeTruthy();
		expect(screen.getAllByText("角色").length).toBeGreaterThan(0);
		expect(
			screen.getByPlaceholderText("搜索素材").parentElement?.parentElement?.className,
		).toContain("minmax(16rem,18rem)");
		const heroPreviewButton = screen.getByRole("button", { name: "预览 hero-media.png" });
		const heroCard = heroPreviewButton.closest("article");
		const heroThumbnail = heroPreviewButton.firstElementChild;
		const heroInfo = heroThumbnail?.nextElementSibling;
		expect(heroCard?.querySelectorAll('span[title="角色"]')).toHaveLength(1);
		expect(heroCard?.querySelectorAll('span[title="图片"]')).toHaveLength(1);
		expect(heroThumbnail?.querySelector('span[title="角色"]')).toBeTruthy();
		expect(heroThumbnail?.querySelector('span[title="图片"]')).toBeNull();
		expect(heroInfo?.querySelector('span[title="图片"]')).toBeTruthy();
		expect(heroCard?.querySelector('[title="library/2026-06-21/asset-hero-media.png"]')).toBeNull();
		expect(screen.queryByText("selected image")).not.toBeInTheDocument();
		expect(screen.queryByText("source-notes.txt")).not.toBeInTheDocument();
		expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
		expect(screen.queryByText("最近更新")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "取消选入" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /重命名/ })).not.toBeInTheDocument();
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: "project-a" });
		expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-a");
		expect(getSelectedGenerationAssets).toHaveBeenCalledWith("project-a");
		expect(deleteSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("labels project media by source document category before it is selected", async () => {
		vi.mocked(getWorkspaceDocuments).mockResolvedValue(
			workspaceDocuments({
				documents: [
					workspaceDocument({ category: "character", id: "doc-character", title: "角色设定" }),
					workspaceDocument({
						category: "reference",
						id: "doc-reference",
						title: "资料文档",
					}),
				],
			}),
		);
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [
				mediaAsset({
					filename: "character-still.png",
					id: "character-media",
					sectionId: "doc-character:section-a",
					url: "/api/v1/media-assets/character-media/content",
				}),
				mediaAsset({
					filename: "reference-still.png",
					id: "reference-media",
					sectionId: "doc-reference:section-b",
					url: "/api/v1/media-assets/reference-media/content",
				}),
			],
		});
		vi.mocked(getSelectedGenerationAssets).mockResolvedValue({ assets: [] });

		renderAssetLibraryButton("/projects?projectId=project-a");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect((await screen.findAllByText("character-still.png")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("reference-still.png")).length).toBeGreaterThan(0);
		const characterPreviewButton = screen.getByRole("button", {
			name: "预览 character-still.png",
		});
		const sourcePreviewButton = screen.getByRole("button", { name: "预览 reference-still.png" });
		const characterCard = characterPreviewButton.closest("article");
		const sourceCard = sourcePreviewButton.closest("article");
		const characterThumbnail = characterPreviewButton.firstElementChild;
		const characterInfo = characterThumbnail?.nextElementSibling;
		const sourceThumbnail = sourcePreviewButton.firstElementChild;
		const sourceInfo = sourceThumbnail?.nextElementSibling;
		const characterBadge = characterCard?.querySelector('span[title="角色"]');
		const characterKindBadge = characterCard?.querySelector('span[title="图片"]');
		const sourceBadge = sourceCard?.querySelector('span[title="资料"]');
		const sourceKindBadge = sourceCard?.querySelector('span[title="图片"]');
		expect(characterCard?.querySelectorAll('span[title="角色"]')).toHaveLength(1);
		expect(characterCard?.querySelectorAll('span[title="图片"]')).toHaveLength(1);
		expect(sourceCard?.querySelectorAll('span[title="资料"]')).toHaveLength(1);
		expect(sourceCard?.querySelectorAll('span[title="图片"]')).toHaveLength(1);
		expect(characterThumbnail?.querySelector('span[title="角色"]')).toBeTruthy();
		expect(characterThumbnail?.querySelector('span[title="图片"]')).toBeNull();
		expect(characterInfo?.querySelector('span[title="图片"]')).toBeTruthy();
		expect(sourceThumbnail?.querySelector('span[title="资料"]')).toBeTruthy();
		expect(sourceThumbnail?.querySelector('span[title="图片"]')).toBeNull();
		expect(sourceInfo?.querySelector('span[title="图片"]')).toBeTruthy();
		expect(characterBadge).toBeTruthy();
		expect(characterBadge).toHaveClass("bg-fuchsia-50/95", "text-fuchsia-800");
		expect(characterKindBadge).toBeTruthy();
		expect(characterKindBadge).toHaveClass("bg-cyan-50/95", "text-cyan-800");
		expect(sourceBadge).toBeTruthy();
		expect(sourceBadge).toHaveClass("bg-stone-50/95", "text-stone-800");
		expect(sourceKindBadge).toBeTruthy();
		expect(sourceKindBadge).toHaveClass("bg-cyan-50/95", "text-cyan-800");
		expect(getSelectedGenerationAssets).toHaveBeenCalledWith("project-a");
	});

	it("shows poster images for video media assets", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [
				mediaAsset({
					filename: "scene-video.mp4",
					id: "video-media",
					kind: "video",
					mimeType: "video/mp4",
					posterUrl: "/api/v1/media-assets/video-media/poster",
					url: "/api/v1/media-assets/video-media/content",
				}),
			],
		});

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect((await screen.findAllByText("scene-video.mp4")).length).toBeGreaterThan(0);
		const videoBadge = document.body.querySelector('span[title="视频"]');
		expect(videoBadge).toBeTruthy();
		expect(videoBadge).toHaveClass("bg-violet-50/95", "text-violet-800");
		expect(
			document.body.querySelector('img[src="/api/v1/media-assets/video-media/poster"]'),
		).toBeTruthy();
		expect(screen.getByTestId("asset-video-player")).toHaveAttribute(
			"data-src",
			"/api/v1/media-assets/video-media/content",
		);
		expect(screen.getByTestId("asset-video-player")).toHaveAttribute(
			"data-poster",
			"/api/v1/media-assets/video-media/poster",
		);
		expect(screen.getByTestId("asset-video-player")).toHaveAttribute(
			"data-show-title-in-controls",
			"false",
		);
	});

	it("uses the shared audio player for audio media previews", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [
				mediaAsset({
					filename: "voiceover.mp3",
					id: "audio-media",
					kind: "audio",
					mimeType: "audio/mpeg",
					sizeBytes: 13_824,
					url: "/api/v1/media-assets/audio-media/content",
				}),
			],
		});

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect((await screen.findAllByText("voiceover.mp3")).length).toBeGreaterThan(0);
		const audioBadge = document.body.querySelector('span[title="音频"]');
		expect(audioBadge).toBeTruthy();
		expect(audioBadge).toHaveClass("bg-rose-50/95", "text-rose-800");
		expect(screen.getByTestId("asset-audio-player")).toHaveAttribute(
			"data-src",
			"/api/v1/media-assets/audio-media/content",
		);
		expect(screen.getByTestId("asset-audio-player")).toHaveAttribute(
			"data-mime-type",
			"audio/mpeg",
		);
	});

	it("switches the library to another project from the project filter", async () => {
		vi.mocked(getMediaAssets).mockImplementation(async (filters) => {
			const projectId = filters?.projectId;
			return {
				assets: [
					mediaAsset({
						filename: projectId ? `${projectId}-media.png` : "global-media.png",
						id: projectId ? `${projectId}-media` : "global-media",
						projectId,
						url: projectId
							? `/api/v1/media-assets/${projectId}-media/content`
							: "/api/v1/media-assets/global-media/content",
					}),
				],
			};
		});
		vi.mocked(getSelectedGenerationAssets).mockResolvedValue({ assets: [] });

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "全局素材库" })).toBeTruthy();
		expect((await screen.findAllByText("global-media.png")).length).toBeGreaterThan(0);

		await waitFor(() => expect(getProjects).toHaveBeenCalled());
		fireEvent.pointerDown(screen.getByRole("combobox", { name: "项目" }), {
			button: 0,
			ctrlKey: false,
			pageX: 0,
			pageY: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.click(await screen.findByRole("option", { name: "项目乙" }));

		expect(await screen.findByRole("dialog", { name: "项目素材库" })).toBeTruthy();
		expect((await screen.findAllByText("project-b-media.png")).length).toBeGreaterThan(0);
		expect(screen.queryByText("project-b-file.txt")).not.toBeInTheDocument();
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: "project-b" });
		expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-b");
		expect(getSelectedGenerationAssets).toHaveBeenCalledWith("project-b");
	});
});

const renderAssetLibraryButton = (initialEntry: string) => {
	window.history.pushState(null, "", initialEntry);
	return render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<AssetLibraryButton />
		</SWRConfig>,
	);
};

const workspaceDocuments = (
	overrides: Partial<Awaited<ReturnType<typeof getWorkspaceDocuments>>> = {},
): Awaited<ReturnType<typeof getWorkspaceDocuments>> => ({
	assets: [],
	documents: [],
	folders: [],
	projectId: "project-a",
	workspaceDir: "/tmp/project-a",
	...overrides,
});

const workspaceDocument = (
	overrides: Partial<Awaited<ReturnType<typeof getWorkspaceDocuments>>["documents"][number]> = {},
): Awaited<ReturnType<typeof getWorkspaceDocuments>>["documents"][number] => ({
	category: "screenplay",
	comments: [],
	content: "",
	id: "doc-a",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: "文档",
	updatedAt: "2026-06-01T09:00:00Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
});

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	createdAt: "2026-06-01T08:00:00Z",
	filename: "media.png",
	id: "media-a",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-06-01T09:00:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});

const selectedAsset = (
	overrides: Partial<SelectedGenerationAsset> = {},
): SelectedGenerationAsset => ({
	assetIndex: 0,
	createdAt: "2026-06-01T10:00:00Z",
	id: "selected-a",
	kind: "image",
	mimeType: "image/png",
	resourceType: "character",
	taskId: "task-a",
	title: "selected image",
	updatedAt: "2026-06-01T10:30:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});

const workspaceProject = (overrides: { id: string; name: string }) => ({
	archivedAt: "",
	createdAt: "2026-06-01T06:00:00Z",
	description: "",
	documentCount: 0,
	id: overrides.id,
	name: overrides.name,
	originalProjectDir: "",
	projectDir: `/tmp/${overrides.id}`,
	relativeDir: overrides.id,
	status: "active" as const,
	trashedAt: "",
	updatedAt: "2026-06-01T06:30:00Z",
});
