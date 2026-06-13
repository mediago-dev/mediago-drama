import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { MediaGenerationWorkspace } from "./MediaGenerationWorkspace";

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/components/useMediaGenerationWorkspaceLayout", () => ({
	historyPanelWidth: { max: 520, min: 280 },
	historyResizeHandleWidth: 1,
	resizeHandleHeight: 1,
	resizeKeyboardStep: 24,
	useMediaGenerationWorkspaceLayout: () => ({
		historyWidth: 320,
		inputPanelHeight: 260,
		nudgeHistoryWidth: vi.fn(),
		nudgeInputPanelHeight: vi.fn(),
		startHistoryResize: vi.fn(),
		startInputPanelResize: vi.fn(),
	}),
}));

vi.mock("@/domains/generation/components/MediaGenerationInputPanel", () => ({
	MediaGenerationInputPanel: ({
		imageSpecControl,
		modelControls,
		previewReferenceAssets = [],
		primaryParamControls,
		secondaryParamControls,
	}: {
		imageSpecControl?: React.ReactNode;
		modelControls?: React.ReactNode;
		previewReferenceAssets?: MediaAsset[];
		primaryParamControls?: React.ReactNode;
		secondaryParamControls?: React.ReactNode;
	}) => (
		<div data-testid="generation-input-panel">
			{modelControls}
			{imageSpecControl}
			{primaryParamControls}
			{secondaryParamControls}
			{previewReferenceAssets.map((asset) => (
				<span key={asset.id}>{asset.filename}</span>
			))}
		</div>
	),
}));

vi.mock("@/domains/generation/components/MediaGenerationWorkspaceDialogs", () => ({
	MediaGenerationWorkspaceDialogs: () => <div data-testid="generation-dialogs" />,
}));

vi.mock("react-photo-view", () => ({
	PhotoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	PhotoView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ src }: { src: string }) => <div data-testid="video-player" data-src={src} />,
}));

const imageEntry: GenerationEntry = {
	id: "entry-image",
	kind: "image",
	status: "completed",
	content: "",
	prompt: "旧提示词",
	requestAssets: [
		{ kind: "image", url: "/api/v1/media-assets/reference-a/content", mimeType: "image/png" },
	],
	assets: [{ kind: "image", url: "/api/v1/media-assets/media-a/content", mimeType: "image/png" }],
};

const secondImageEntry: GenerationEntry = {
	id: "entry-image-2",
	kind: "image",
	status: "completed",
	content: "",
	prompt: "新提示词",
	assets: [{ kind: "image", url: "/api/v1/media-assets/media-b/content", mimeType: "image/png" }],
};

const mediaAsset: MediaAsset = {
	id: "media-a",
	kind: "image",
	filename: "source.png",
	mimeType: "image/png",
	sizeBytes: 12,
	url: "/api/v1/media-assets/media-a/content",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const workspaceDefaults = {
	activeEntryId: "entry-image",
	canSubmit: true,
	composerLayers: [],
	deleteGenerationEntry: vi.fn(),
	deletingEntryIds: [],
	error: null,
	hasConfiguredRoutesForKind: true,
	isSubmitting: false,
	isUploadingAsset: false,
	kind: "image",
	mediaAssets: [mediaAsset],
	mutateMediaAssets: vi.fn(),
	orderedGenerationEntries: [imageEntry, secondImageEntry],
	fullPrompt: "完整提示词",
	prompt: "旧提示词",
	selectableReferenceKinds: new Set(["image"]),
	selectedFamily: { id: "image-family", label: "图像模型" },
	selectedParams: {},
	selectedReferenceAssetIds: [],
	selectedReferenceAssets: [],
	selectedRoute: {
		adapter: "test.image",
		configured: true,
		docUrl: "https://example.com",
		familyId: "image-family",
		id: "route-image",
		kind: "image",
		model: "image-model",
		params: [],
		provider: "openai",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "version-image",
	},
	selectedVersion: { id: "version-image", label: "v1" },
	setActiveEntryId: vi.fn(),
	setKind: vi.fn(),
	setLayerSelection: vi.fn(),
	setPrompt: vi.fn(),
	submit: vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault()),
	toggleReferenceAsset: vi.fn(),
	updateFamily: vi.fn(),
	updateModelRoute: vi.fn(),
	updateParam: vi.fn(),
	uploadIdPrefix: "test-generation",
	uploadReferenceAsset: vi.fn(),
	visibleFamilies: [{ id: "image-family", label: "图像模型" }],
	visibleFamilyRoutes: [
		{
			adapter: "test.image",
			configured: true,
			docUrl: "https://example.com",
			familyId: "image-family",
			id: "route-image",
			kind: "image",
			model: "image-model",
			params: [],
			provider: "openai",
			status: "available",
			supportsReferenceUrls: true,
			versionId: "version-image",
		},
	],
	visibleRoutes: [],
	visibleVersions: [{ id: "version-image", label: "v1" }],
};

describe("MediaGenerationWorkspace", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
	});

	it("uses a generated image as a reference without changing the prompt", () => {
		const setPrompt = vi.fn();
		const selectReferenceAsset = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			selectReferenceAsset,
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
			/>,
		);

		setPrompt.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "用作参考图" }));

		expect(selectReferenceAsset).toHaveBeenCalledWith(mediaAsset);
		expect(setPrompt).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("renders the model route picker in the input panel", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
			/>,
		);

		expect(screen.getByRole("button", { name: "模型版本和供应商" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "打开模型文档" })).toBeTruthy();
	});

	it("keeps the tabbed edit view focused on the input without history or results", () => {
		const setPrompt = vi.fn();
		const onHistoryCountChange = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onHistoryCountChange={onHistoryCountChange}
				viewMode="edit"
			/>,
		);

		expect(screen.getByTestId("generation-input-panel")).toBeTruthy();
		expect(screen.getByText("旧提示词")).toBeTruthy();
		expect(screen.getByText("新提示词")).toBeTruthy();
		expect(screen.getByText("旧提示词").closest("article")?.className).not.toContain(
			"border-primary",
		);
		expect(screen.queryByRole("button", { name: "预览生成图片" })).toBeNull();
		expect(setPrompt).not.toHaveBeenCalled();
		expect(onHistoryCountChange).toHaveBeenCalledWith(2);
	});

	it("opens history preview when selecting a history item from the tabbed edit view", () => {
		const onViewModeChange = vi.fn();
		const setActiveEntryId = vi.fn();
		const setPrompt = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			setActiveEntryId,
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onViewModeChange={onViewModeChange}
				viewMode="edit"
			/>,
		);

		fireEvent.click(screen.getByText("新提示词"));

		expect(setActiveEntryId).toHaveBeenCalledWith("entry-image-2");
		expect(onViewModeChange).toHaveBeenCalledWith("history");
		expect(setPrompt).not.toHaveBeenCalled();
	});

	it("selects history in tabbed history view without overwriting the edit prompt", () => {
		const setActiveEntryId = vi.fn();
		const setPrompt = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			setActiveEntryId,
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByText("新提示词"));

		expect(setActiveEntryId).toHaveBeenCalledWith("entry-image-2");
		expect(setPrompt).not.toHaveBeenCalled();
	});

	it("shows the selected history request reference assets in history preview", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				viewMode="history"
			/>,
		);

		expect(screen.getByText("历史参考图")).toBeTruthy();
		expect(screen.getByText("生成时使用 1 个")).toBeTruthy();
		expect(screen.getByRole("button", { name: "预览 历史参考图 1" })).toBeTruthy();
	});

	it("copies the active history prompt into the editor only when explicitly requested", () => {
		const onViewModeChange = vi.fn();
		const setPrompt = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onViewModeChange={onViewModeChange}
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "用此提示词编辑" }));

		expect(setPrompt).toHaveBeenCalledWith("旧提示词");
		expect(onViewModeChange).toHaveBeenCalledWith("edit");
	});

	it("copies the active history request references into the editor with the prompt", () => {
		const setPrompt = vi.fn();
		const workspaceOptions: Array<Parameters<typeof useGenerationWorkspace>[0]> = [];
		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions.push(options);
			return {
				...workspaceDefaults,
				setPrompt,
			} as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		const Harness = () => {
			const [viewMode, setViewMode] = useState<"edit" | "history">("history");

			return (
				<MediaGenerationWorkspace
					historyScopeId="history-a"
					initialPrompt="初始提示词"
					kind="image"
					viewMode={viewMode}
					onViewModeChange={(nextViewMode) => setViewMode(nextViewMode)}
				/>
			);
		};

		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "用此提示词编辑" }));

		expect(setPrompt).toHaveBeenCalledWith("旧提示词");
		expect(screen.getByTestId("generation-input-panel")).toBeTruthy();
		expect(screen.getByText("历史参考图 1")).toBeTruthy();

		const latestOptions = workspaceOptions.at(-1);
		const referenceUrls =
			typeof latestOptions?.extraReferenceUrls === "function"
				? latestOptions.extraReferenceUrls("旧提示词")
				: (latestOptions?.extraReferenceUrls ?? []);
		expect(
			referenceUrls.some((url) => url.endsWith("/api/v1/media-assets/reference-a/content")),
		).toBe(true);
	});

	it("passes image spec control to the input panel and filters advanced params", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			selectedParams: {
				aspectRatio: "1:1",
				imageSize: "2K",
				n: 1,
				quality: "high",
			},
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				params: [
					{
						name: "aspectRatio",
						label: "画幅比例",
						type: "select",
						default: "1:1",
						options: [
							{ label: "1:1", value: "1:1" },
							{ label: "16:9", value: "16:9" },
						],
					},
					{
						name: "imageSize",
						label: "图像尺寸",
						type: "select",
						default: "2K",
						options: [
							{ label: "2K", value: "2K" },
							{ label: "4K", value: "4K" },
						],
					},
					{ name: "quality", label: "质量", type: "select", default: "high" },
					{ name: "n", label: "图像数量", type: "number", default: 1, min: 1, max: 4 },
				],
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
			/>,
		);

		expect(screen.getByRole("button", { name: /图片大小/ })).toBeTruthy();
		expect(screen.queryByText("质量")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "其他" }));

		expect(screen.getByText("质量")).toBeTruthy();
	});

	it("passes video spec and duration as primary controls while keeping only secondary params in other", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			kind: "video",
			selectedParams: {
				aspectRatio: "16:9",
				resolution: "720p",
				duration: "5",
				generateAudio: false,
			},
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				kind: "video",
				params: [
					{
						name: "aspectRatio",
						label: "比例",
						type: "select",
						menu: "primary",
						default: "16:9",
						options: [
							{ label: "16:9", value: "16:9" },
							{ label: "9:16", value: "9:16" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						menu: "primary",
						default: "720p",
						options: [
							{ label: "480p", value: "480p" },
							{ label: "720p", value: "720p" },
						],
					},
					{
						name: "duration",
						label: "时长",
						type: "select",
						menu: "primary",
						default: "5",
						options: [
							{ label: "4 秒", value: "4" },
							{ label: "5 秒", value: "5" },
						],
					},
					{
						name: "generateAudio",
						label: "生成音频",
						type: "boolean",
						menu: "secondary",
						default: false,
					},
				],
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
			/>,
		);

		expect(screen.getByRole("button", { name: /视频大小/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: "秒数：5 秒" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "其他" }));

		expect(screen.getByText("生成音频")).toBeTruthy();
	});

	it("hides the other entry when there are no secondary params", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			selectedParams: {
				aspectRatio: "1:1",
				resolution: "2K",
			},
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				params: [
					{
						name: "aspectRatio",
						label: "画幅比例",
						type: "select",
						menu: "primary",
						default: "1:1",
						options: [
							{ label: "1:1", value: "1:1" },
							{ label: "16:9", value: "16:9" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						menu: "primary",
						default: "2K",
						options: [
							{ label: "2K", value: "2K" },
							{ label: "4K", value: "4K" },
						],
					},
				],
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
			/>,
		);

		expect(screen.queryByRole("button", { name: "其他" })).toBeNull();
	});
});
