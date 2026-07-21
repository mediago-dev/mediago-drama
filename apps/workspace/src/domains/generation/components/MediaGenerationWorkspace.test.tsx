import {
	cleanup,
	fireEvent,
	render as testingRender,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import React from "react";
import { useState } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GenerationAsset,
	GenerationMessageResponse,
	GenerationParam,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	type GenerationEntry,
	useGenerationWorkspacePreferenceStore,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { MediaGenerationWorkspace } from "./MediaGenerationWorkspace";

const toastMocks = vi.hoisted(() => ({
	copySuccess: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
	warning: vi.fn(),
}));
const generationApiMocks = vi.hoisted(() => ({
	createGenerationConversation: vi.fn(
		async (request: {
			id?: string;
			sessionId?: string;
			kind?: string;
			scopeId?: string;
			title?: string;
		}) => ({
			createdAt: "2026-01-01T00:00:00.000Z",
			id: request.id ?? request.sessionId ?? "",
			kind: request.kind,
			scopeId: request.scopeId,
			sessionId: request.sessionId ?? request.id ?? "",
			title: request.title ?? "",
			updatedAt: "2026-01-01T00:00:00.000Z",
		}),
	),
	previewGenerationVoice: vi.fn(),
	selectedGenerationAssetsQueryKey: vi.fn((projectId: string) => [
		"generation-selected-assets",
		projectId,
	]),
	streamGenerationText: vi.fn(),
	updateSelectedGenerationAsset: vi.fn(
		async (_projectId: string, _request: Record<string, unknown>) => ({}),
	),
}));
const mediaApiMocks = vi.hoisted(() => ({
	uploadMediaAsset: vi.fn(),
}));
const desktopActionMocks = vi.hoisted(() => ({
	copyDesktopFileToDirectory: vi.fn(),
	openExternalUrl: vi.fn(),
	pickDesktopDirectory: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();

	return {
		...actual,
		createGenerationConversation: generationApiMocks.createGenerationConversation,
		previewGenerationVoice: generationApiMocks.previewGenerationVoice,
		selectedGenerationAssetsQueryKey: generationApiMocks.selectedGenerationAssetsQueryKey,
		streamGenerationText: generationApiMocks.streamGenerationText,
		updateSelectedGenerationAsset: generationApiMocks.updateSelectedGenerationAsset,
	};
});

vi.mock("@/hooks/useToast", () => ({
	useToast: () => toastMocks,
}));

vi.mock("@/domains/workspace/api/media", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/workspace/api/media")>();

	return {
		...actual,
		uploadMediaAsset: mediaApiMocks.uploadMediaAsset,
	};
});

vi.mock("@/shared/desktop/actions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/shared/desktop/actions")>();

	return {
		...actual,
		copyDesktopFileToDirectory: desktopActionMocks.copyDesktopFileToDirectory,
		openExternalUrl: desktopActionMocks.openExternalUrl,
		pickDesktopDirectory: desktopActionMocks.pickDesktopDirectory,
	};
});

vi.mock("@/domains/generation/components/ImageStickerEditorDialog", () => ({
	ImageStickerEditorDialog: ({
		onSave,
		open,
	}: {
		onSave: (result: { file: File; mimeType: string }) => Promise<void> | void;
		open: boolean;
	}) =>
		open ? (
			<div role="dialog" aria-label="图片编辑工作台">
				<button
					type="button"
					onClick={() =>
						void onSave({
							file: new File(["edited"], "edited.png", { type: "image/png" }),
							mimeType: "image/png",
						})
					}
				>
					保存编辑图
				</button>
			</div>
		) : null,
}));

vi.mock("@/domains/generation/components/useMediaGenerationWorkspaceLayout", () => ({
	historyPanelWidth: { max: 520, min: 280 },
	historyResizeHandleWidth: 1,
	resizeHandleHeight: 1,
	resizeKeyboardStep: 24,
	useMediaGenerationWorkspaceLayout: () => ({
		historyWidth: 320,
		nudgeHistoryWidth: vi.fn(),
		startHistoryResize: vi.fn(),
	}),
}));

vi.mock("@/domains/generation/components/MediaGenerationInputPanel", () => ({
	MediaGenerationInputPanel: ({
		error,
		imageSpecControl,
		modelControls,
		previewReferenceAssets = [],
		primaryParamControls,
		promptEditor,
		promptOptimizeControl,
		referenceButtonLabel,
		secondaryParamControls,
	}: {
		error?: string | null;
		imageSpecControl?: React.ReactNode;
		modelControls?: React.ReactNode;
		previewReferenceAssets?: MediaAsset[];
		primaryParamControls?: React.ReactNode;
		promptEditor?: React.ReactNode;
		promptOptimizeControl?: React.ReactNode;
		referenceButtonLabel?: string;
		secondaryParamControls?: React.ReactNode;
	}) => {
		const promptEditorClassName = React.isValidElement<{ className?: string }>(promptEditor)
			? (promptEditor.props.className ?? "")
			: "";

		return (
			<div data-testid="generation-input-panel">
				<div data-testid="document-prompt-editor-class" data-class={promptEditorClassName} />
				<div data-testid="reference-button-label">{referenceButtonLabel}</div>
				{error ? <div role="alert">{error}</div> : null}
				{modelControls}
				{imageSpecControl}
				{primaryParamControls}
				{promptOptimizeControl}
				{secondaryParamControls}
				{previewReferenceAssets.map((asset) => (
					<span key={asset.id}>{asset.filename}</span>
				))}
			</div>
		);
	},
}));

vi.mock("@/domains/generation/components/MediaGenerationWorkspaceDialogs", () => ({
	MediaGenerationWorkspaceDialogs: ({
		onToggleInlineReference,
		referenceShortcutGroups = [],
	}: {
		onToggleInlineReference?: (asset: MediaAsset) => void;
		referenceShortcutGroups?: Array<{ items: Array<{ asset: MediaAsset; title: string }> }>;
	}) => {
		const shortcut = referenceShortcutGroups[0]?.items[0];

		return (
			<div data-testid="generation-dialogs">
				{shortcut ? (
					<button type="button" onClick={() => onToggleInlineReference?.(shortcut.asset)}>
						选择快捷参考 {shortcut.title}
					</button>
				) : null}
			</div>
		);
	},
}));

vi.mock("react-photo-view", () => ({
	PhotoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	PhotoSlider: ({ visible }: { visible: boolean }) =>
		visible ? <div role="dialog" aria-label="图片预览" /> : null,
	PhotoView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ src }: { src: string }) => <div data-testid="video-player" data-src={src} />,
}));

vi.mock("@/components/AudioPlayer", () => ({
	AudioPlayer: ({ mimeType, src }: { mimeType?: string; src: string }) => (
		<div data-testid="audio-player" data-mime-type={mimeType} data-src={src} />
	),
}));

const render = (ui: React.ReactElement) =>
	testingRender(
		<>
			{ui}
			<ConfirmDialog />
		</>,
	);

const renderWithIsolatedSWR = (ui: React.ReactElement) =>
	testingRender(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			{ui}
			<ConfirmDialog />
		</SWRConfig>,
	);

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

const generationResponseFromEntry = (entry: GenerationEntry): GenerationMessageResponse => ({
	id: entry.id,
	role: "assistant",
	status: entry.status ?? "completed",
	message: entry.content,
	assets: entry.assets ?? [],
	usage: {
		cachedTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
	},
});

const pendingImageEntry: GenerationEntry = {
	id: "entry-pending-image",
	kind: "image",
	status: "running",
	content: "",
	prompt: "生成四张图",
	requestDetails: [{ label: "图像数量", value: "4" }],
	assets: [],
};

const videoEntry: GenerationEntry = {
	id: "entry-video",
	kind: "video",
	status: "completed",
	content: "",
	prompt: "视频提示词",
	assets: [{ kind: "video", url: "/api/v1/media-assets/video-a/content", mimeType: "video/mp4" }],
};

const failedVideoEntry: GenerationEntry = {
	id: "local-123:error",
	kind: "video",
	status: "error",
	content: "生成失败",
	error: "生成失败",
	prompt: "视频提示词",
	assets: [],
};

const importedMaterialEntry: GenerationEntry = {
	id: "media-library-1",
	kind: "image",
	status: "completed",
	content: "已从素材库导入。",
	prompt: "从素材库导入：source.png",
	requestDetails: [
		{ label: "来源", value: "素材库" },
		{ label: "文件", value: "source.png" },
	],
	resultDetails: [
		{ label: "来源", value: "素材库" },
		{ label: "文件", value: "source.png" },
	],
	assets: [
		{
			kind: "image",
			mimeType: "image/png",
			selected: false,
			title: "主角 底层青年 / 低阶散修",
			url: "/api/v1/media-assets/media-a/content",
		},
	],
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

const videoMediaAsset: MediaAsset = {
	id: "video-a",
	kind: "video",
	filename: "scene.mp4",
	mimeType: "video/mp4",
	sizeBytes: 4096,
	url: "/api/v1/media-assets/video-a/content",
	posterUrl: "/api/v1/media-assets/video-a/poster",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const audioVoiceParam: GenerationParam = {
	name: "voiceId",
	label: "音色",
	type: "select",
	group: "voice",
	menu: "primary",
	default: "female-shaonv",
	options: [
		{ label: "中文 (普通话) · 少女音色", value: "female-shaonv" },
		{ label: "中文 (普通话) · 精英青年音色", value: "male-qn-jingying" },
	],
};

const workspaceDefaults = {
	activeEntryId: "entry-image",
	addPromptSource: vi.fn(),
	canSubmit: true,
	deletedAssetPlaceholderCounts: {},
	deleteGenerationEntry: vi.fn(),
	deleteGenerationEntryAsset: vi.fn(),
	deleteGenerationEntryAssetPlaceholder: vi.fn(),
	deletingEntryIds: [],
	error: null,
	hasConfiguredRoutesForKind: true,
	importMediaAssetsToHistory: vi.fn(),
	isImportingMediaAssets: false,
	isSubmitting: false,
	isUploadingAsset: false,
	kind: "image",
	mediaAssets: [mediaAsset],
	mutateMediaAssets: vi.fn(),
	mutateTasks: vi.fn(),
	orderedGenerationEntries: [imageEntry, secondImageEntry],
	fullPrompt: "完整提示词",
	prompt: "旧提示词",
	promptInsertItems: [],
	promptReferenceItems: [],
	promptSourceRefs: [],
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
	setPrompt: vi.fn(),
	submit: vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault()),
	submitGeneration: vi.fn(),
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

const promptInsertItem = {
	id: "prompt-cinematic",
	categoryLabel: "风格",
	name: "电影质感",
	prompt: "cinematic lighting, detailed composition",
	sourceLabel: "来自包",
};

const textGenerationCatalog = {
	families: [{ id: "text-family", kind: "text", label: "文本模型" }],
	models: [],
	providers: [],
	routes: [
		{
			adapter: "test.text",
			async: false,
			configured: true,
			docUrl: "https://example.com/text",
			familyId: "text-family",
			id: "text-route",
			kind: "text",
			label: "Text Route",
			model: "text-model",
			params: [],
			provider: "openai",
			status: "available",
			supportsReferenceUrls: false,
			versionId: "text-version",
		},
		{
			adapter: "test.text.dmx",
			async: false,
			configured: true,
			docUrl: "https://example.com/text-dmx",
			familyId: "text-family",
			id: "text-route-dmx",
			kind: "text",
			label: "DMX Text Route",
			model: "dmx-text-model",
			params: [],
			provider: "dmx",
			status: "available",
			supportsReferenceUrls: false,
			versionId: "text-version-dmx",
		},
	],
	versions: [
		{
			canonicalModel: "text-model",
			capabilities: { async: false, supportsReferenceUrls: false },
			familyId: "text-family",
			id: "text-version",
			kind: "text",
			label: "Text v1",
		},
		{
			canonicalModel: "dmx-text-model",
			capabilities: { async: false, supportsReferenceUrls: false },
			familyId: "text-family",
			id: "text-version-dmx",
			kind: "text",
			label: "DMX Text v1",
		},
	],
};

describe("MediaGenerationWorkspace", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		useGenerationWorkspacePreferenceStore.getState().setPromptOptimizeRouteId("");
		generationApiMocks.streamGenerationText.mockReset();
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
	});

	it("caches local voice previews from the matching audio family route", async () => {
		const originalAudio = globalThis.Audio;
		const playMock = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new DOMException("autoplay blocked", "NotAllowedError"))
			.mockResolvedValue(undefined);
		const pauseMock = vi.fn();
		const audioSources: string[] = [];

		class MockAudio {
			src: string;

			constructor(src?: string) {
				this.src = src ?? "";
				audioSources.push(this.src);
			}

			play = playMock;
			pause = pauseMock;
		}

		Object.defineProperty(globalThis, "Audio", {
			configurable: true,
			value: MockAudio,
			writable: true,
		});

		generationApiMocks.previewGenerationVoice.mockResolvedValue({
			asset: {
				kind: "audio",
				mimeType: "audio/mpeg",
				url: "/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/male-qn-jingying",
			},
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: {
				families: [],
				models: [],
				providers: [],
				routes: [],
				versions: [],
				voicePreviews: [
					{
						mimeType: "audio/mpeg",
						routeId: "official.minimax-speech-2.8-turbo",
						url: "/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/male-qn-jingying",
						voiceId: "male-qn-jingying",
					},
				],
			},
			kind: "audio",
			selectedFamily: { id: "minimax-speech", label: "MiniMax 国内 Speech" },
			selectedParams: {
				voiceId: "female-shaonv",
			},
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				adapter: "official.minimax.speech",
				familyId: "minimax-speech",
				id: "official.minimax-speech-2.8-hd",
				kind: "audio",
				model: "speech-2.8-hd",
				params: [audioVoiceParam],
				provider: "minimax",
				supportsReferenceUrls: false,
				versionId: "minimax-speech-2.8-hd",
			},
			selectedVersion: { id: "minimax-speech-2.8-hd", label: "Minimax-speech-2.8-hd" },
			visibleFamilies: [{ id: "minimax-speech", label: "MiniMax 国内 Speech" }],
			visibleFamilyRoutes: [
				{
					...workspaceDefaults.selectedRoute,
					adapter: "official.minimax.speech",
					familyId: "minimax-speech",
					id: "official.minimax-speech-2.8-hd",
					kind: "audio",
					model: "speech-2.8-hd",
					params: [audioVoiceParam],
					provider: "minimax",
					supportsReferenceUrls: false,
					versionId: "minimax-speech-2.8-hd",
				},
				{
					...workspaceDefaults.selectedRoute,
					adapter: "official.minimax.speech",
					familyId: "minimax-speech",
					id: "official.minimax-speech-2.8-turbo",
					kind: "audio",
					model: "speech-2.8-turbo",
					params: [audioVoiceParam],
					provider: "minimax",
					supportsReferenceUrls: false,
					versionId: "minimax-speech-2.8-turbo",
				},
			],
			visibleVersions: [{ id: "minimax-speech-2.8-hd", label: "Minimax-speech-2.8-hd" }],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		try {
			render(
				<MediaGenerationWorkspace
					historyScopeId="history-a"
					initialPrompt="初始提示词"
					kind="audio"
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "音色：中文 (普通话) · 少女音色" }));
			await screen.findByRole("dialog", { name: "音色" });
			fireEvent.click(screen.getByRole("button", { name: "预览 中文 (普通话) · 精英青年音色" }));

			await waitFor(() => {
				expect(generationApiMocks.previewGenerationVoice).toHaveBeenCalledWith({
					routeId: "official.minimax-speech-2.8-turbo",
					voiceId: "male-qn-jingying",
				});
				expect(toastMocks.warning).toHaveBeenCalledWith("试听已生成", {
					description: "浏览器拦截了自动播放，请再点一次播放。",
				});
			});

			fireEvent.click(screen.getByRole("button", { name: "预览 中文 (普通话) · 精英青年音色" }));

			await waitFor(() => {
				expect(playMock).toHaveBeenCalledTimes(2);
			});
			fireEvent.click(
				await screen.findByRole("button", { name: "暂停 中文 (普通话) · 精英青年音色" }),
			);
			expect(generationApiMocks.previewGenerationVoice).toHaveBeenCalledTimes(1);
			expect(pauseMock).toHaveBeenCalledTimes(1);
			expect(audioSources).toEqual([
				"/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/male-qn-jingying",
				"/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/male-qn-jingying",
			]);
		} finally {
			Object.defineProperty(globalThis, "Audio", {
				configurable: true,
				value: originalAudio,
				writable: true,
			});
		}
	});

	it("submits prompts from the modal without workspace prompt enrichment", () => {
		const workspaceOptions: Array<Parameters<typeof useGenerationWorkspace>[0]> = [];
		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions.push(options);
			return workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
			/>,
		);

		expect(workspaceOptions.at(-1)).toEqual(
			expect.objectContaining({
				projectStyleOnly: true,
				useRawPrompt: true,
			}),
		);
	});

	it("renders the tabbed history list under StrictMode without recursive ref updates", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		render(
			<React.StrictMode>
				<MediaGenerationWorkspace
					historyScopeId="history-a"
					initialPrompt="初始提示词"
					kind="image"
					selectedAssetKeys={["image:/api/v1/media-assets/media-a/content"]}
					viewMode="history"
					onToggleAsset={vi.fn()}
				/>
			</React.StrictMode>,
		);

		expect(screen.getByRole("checkbox", { name: "取消选入结果" })).toBeTruthy();
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

	it("labels video references as reference material in the input panel", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			kind: "video",
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				adapter: "openrouter.video",
				kind: "video",
				provider: "openrouter",
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
			/>,
		);

		expect(screen.getByTestId("reference-button-label").textContent).toBe("参考素材");
	});

	it("passes a 2-to-9-line prompt editor to the document input panel", () => {
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

		const promptEditorClassName = screen
			.getByTestId("document-prompt-editor-class")
			.getAttribute("data-class");

		expect(promptEditorClassName).toContain(
			"min-h-[var(--generation-composer-textarea-min-height)]",
		);
		expect(promptEditorClassName).toContain(
			"max-h-[var(--generation-composer-textarea-max-height)]",
		);
		expect(promptEditorClassName).toContain("resize-none");
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
		expect(screen.queryByText("旧提示词")).toBeNull();
		expect(screen.queryByText("新提示词")).toBeNull();
		expect(screen.queryByRole("separator", { name: "调整历史生成宽度" })).toBeNull();
		expect(screen.queryByRole("button", { name: "预览生成图片" })).toBeNull();
		expect(setPrompt).not.toHaveBeenCalled();
		expect(onHistoryCountChange).toHaveBeenCalledWith(2);
	});

	it("keeps tabbed history rows read-only while preserving explicit actions", () => {
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

		fireEvent.click(screen.getAllByRole("button", { name: "预览图片" })[1]);

		expect(setActiveEntryId).not.toHaveBeenCalled();
		expect(setPrompt).not.toHaveBeenCalled();
	});

	it("renders tabbed history beside the edit panel with in-place asset selection", () => {
		const onToggleAsset = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				selectedAssetKeys={["image:/api/v1/media-assets/media-a/content"]}
				viewMode="history"
			/>,
		);

		expect(screen.getByRole("region", { name: "历史记录" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "编辑" })).toBeTruthy();
		expect(screen.getByTestId("generation-input-panel")).toBeTruthy();
		expect(screen.queryByRole("separator", { name: "调整历史生成宽度" })).toBeNull();

		const firstRow = screen.getAllByRole("article")[0];
		const secondRow = screen.getAllByRole("article")[1];

		if (!firstRow || !secondRow) throw new Error("missing history rows");

		expect(within(firstRow).queryByText("1 张")).toBeNull();
		expect(within(firstRow).queryByText("已选")).toBeNull();
		expect(screen.queryByText("旧提示词")).toBeNull();
		expect(screen.queryByText("新提示词")).toBeNull();
		expect(
			within(firstRow).getByRole("checkbox", { name: "取消选入结果" }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(within(secondRow).getByRole("checkbox", { name: "选入结果" }));

		expect(onToggleAsset).toHaveBeenCalledWith(secondImageEntry.assets?.[0], true);
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("selects the first generated image by default when the target has no selection", async () => {
		const onToggleAsset = vi.fn();
		const firstAsset: GenerationAsset = {
			kind: "image",
			mimeType: "image/png",
			url: "/api/v1/media-assets/generated-first/content",
		};
		const secondAsset: GenerationAsset = {
			kind: "image",
			mimeType: "image/png",
			url: "/api/v1/media-assets/generated-second/content",
		};
		const completedEntry: GenerationEntry = {
			id: "task-generated",
			kind: "image",
			status: "completed",
			content: "",
			prompt: "生成角色图",
			assets: [firstAsset, secondAsset],
		};
		let workspaceOptions: Parameters<typeof useGenerationWorkspace>[0] | undefined;
		let orderedGenerationEntries: GenerationEntry[] = [];
		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions = options;
			return {
				...workspaceDefaults,
				activeEntryId: completedEntry.id,
				orderedGenerationEntries,
			} as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		const renderWorkspace = () => (
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				selectedAssetKeys={[]}
				viewMode="history"
			/>
		);
		const { rerender } = render(renderWorkspace());

		workspaceOptions?.onSubmitStart?.({
			kind: "image",
			localMessageId: "local-generated",
			prompt: "生成角色图",
		});
		workspaceOptions?.onSubmitResponse?.({
			kind: "image",
			localMessageId: "local-generated",
			response: generationResponseFromEntry(completedEntry),
		});
		orderedGenerationEntries = [completedEntry];
		rerender(renderWorkspace());

		await waitFor(() => {
			expect(onToggleAsset).toHaveBeenCalledWith(firstAsset, true);
		});
		expect(onToggleAsset).not.toHaveBeenCalledWith(secondAsset, true);
	});

	it("does not default-select a generated image when the target already has a selection", async () => {
		const onToggleAsset = vi.fn();
		const completedEntry: GenerationEntry = {
			id: "task-generated",
			kind: "image",
			status: "completed",
			content: "",
			prompt: "生成角色图",
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					url: "/api/v1/media-assets/generated-first/content",
				},
			],
		};
		let workspaceOptions: Parameters<typeof useGenerationWorkspace>[0] | undefined;
		let orderedGenerationEntries: GenerationEntry[] = [];
		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions = options;
			return {
				...workspaceDefaults,
				activeEntryId: completedEntry.id,
				orderedGenerationEntries,
			} as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		const renderWorkspace = () => (
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				selectedAssetKeys={["image:/api/v1/media-assets/existing/content"]}
				viewMode="history"
			/>
		);
		const { rerender } = render(renderWorkspace());

		workspaceOptions?.onSubmitStart?.({
			kind: "image",
			localMessageId: "local-generated",
			prompt: "生成角色图",
		});
		workspaceOptions?.onSubmitResponse?.({
			kind: "image",
			localMessageId: "local-generated",
			response: generationResponseFromEntry(completedEntry),
		});
		orderedGenerationEntries = [completedEntry];
		rerender(renderWorkspace());

		await waitFor(() => {
			expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
		});
		expect(onToggleAsset).not.toHaveBeenCalled();
	});

	it("optimistically updates controlled selection when toggling assets", () => {
		const onToggleAsset = vi.fn();
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					selected: true,
					url: "/api/v1/media-assets/media-a/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				selectedAssetKeys={[]}
				viewMode="history"
			/>,
		);

		const checkbox = screen.getByRole("checkbox", { name: "选入结果" });
		expect(checkbox.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(checkbox);

		expect(onToggleAsset).toHaveBeenCalledWith(selectedEntry.assets?.[0], true);
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("does not mirror externally selected document assets into project selected resources", () => {
		const onToggleAsset = vi.fn();
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			id: "task-document-selected",
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					taskId: "task-document-selected",
					url: "/api/v1/media-assets/media-document-selected/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				projectId="project-a"
				selectedAssetKeys={["image:/api/v1/media-assets/media-document-selected/content"]}
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		expect(screen.getByRole("checkbox", { name: "取消选入结果" })).toBeTruthy();
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("persists selected generated image with the document title", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					slotIndex: 2,
					taskId: "task-a",
					url: "/api/v1/media-assets/media-a/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-character"
				selectedAssetSourceDocumentId="character-doc"
				selectedAssetTitle="主角 底层青年 / 低阶散修"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalledWith(
				"project-a",
				expect.objectContaining({
					assetIndex: 2,
					kind: "image",
					mimeType: "image/png",
					resourceId: "section-character",
					resourceTitle: "主角 底层青年 / 低阶散修",
					resourceType: "character",
					selected: true,
					sourceAssetIndex: 2,
					sourceDocumentId: "character-doc",
					sourceTaskId: "task-a",
					sourceType: "generated",
					taskId: "task-a",
					title: "主角 底层青年 / 低阶散修",
					url: "/api/v1/media-assets/media-a/content",
				}),
			);
		});
	});

	it("persists a historical generated image by asset id without sending a mismatched task slot", async () => {
		const historicalEntry: GenerationEntry = {
			...imageEntry,
			id: "local-history-entry",
			assets: [
				{
					assetId: "historical-media-a",
					kind: "image",
					mimeType: "image/png",
					slotIndex: 0,
					taskId: "mismatched-task-for-another-image",
					url: "/api/v1/media-assets/historical-media-a/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: historicalEntry.id,
			orderedGenerationEntries: [historicalEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-character"
				selectedAssetSourceDocumentId="character-doc"
				selectedAssetTitle="林墨"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalled();
		});
		const request = generationApiMocks.updateSelectedGenerationAsset.mock.calls.at(-1)?.[1];
		expect(request).toEqual(
			expect.objectContaining({
				kind: "image",
				mediaAssetId: "historical-media-a",
				resourceId: "section-character",
				resourceType: "character",
				selected: true,
				sourceDocumentId: "character-doc",
				title: "林墨",
			}),
		);
		expect(request).not.toHaveProperty("assetIndex");
		expect(request).not.toHaveProperty("sourceAssetIndex");
		expect(request).not.toHaveProperty("sourceTaskId");
		expect(request).not.toHaveProperty("taskId");
	});

	it("does not expose project resource selection without a resource id", () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					slotIndex: 0,
					taskId: "task-a",
					url: "/api/v1/media-assets/media-a/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		expect(screen.queryByRole("checkbox", { name: "选入结果" })).toBeNull();
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("rolls back selected generated image when project resource save fails", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					slotIndex: 0,
					taskId: "task-a",
					url: "/api/v1/media-assets/media-a/content",
				},
			],
		};
		generationApiMocks.updateSelectedGenerationAsset.mockRejectedValueOnce(
			new Error("backend unavailable"),
		);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(screen.getByRole("checkbox", { name: "选入结果" }).getAttribute("aria-checked")).toBe(
				"false",
			);
		});
		expect(screen.queryByRole("checkbox", { name: "取消选入结果" })).toBeNull();
		expect(toastMocks.error).toHaveBeenCalledWith("backend unavailable");
	});

	it("ignores an older failed selection save after a newer toggle", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					slotIndex: 0,
					taskId: "task-a",
					url: "/api/v1/media-assets/media-a/content",
				},
			],
		};
		let rejectFirstSave!: (error: Error) => void;
		let rejectSecondSave!: (error: Error) => void;
		generationApiMocks.updateSelectedGenerationAsset
			.mockReturnValueOnce(
				new Promise((_, reject) => {
					rejectFirstSave = reject;
				}),
			)
			.mockReturnValueOnce(
				new Promise((_, reject) => {
					rejectSecondSave = reject;
				}),
			);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));
		expect(screen.getByRole("checkbox", { name: "取消选入结果" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "取消选入结果" }));
		expect(screen.getByRole("checkbox", { name: "选入结果" })).toBeTruthy();

		rejectSecondSave(new Error("second save failed"));
		await waitFor(() => {
			expect(screen.getByRole("checkbox", { name: "取消选入结果" })).toBeTruthy();
		});

		rejectFirstSave(new Error("first save failed"));
		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalledTimes(2);
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(screen.getByRole("checkbox", { name: "取消选入结果" })).toBeTruthy();
	});

	it("persists the first generated image when the response omits slotIndex zero", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			id: "task-first",
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					taskId: "task-first",
					url: "/api/v1/media-assets/media-first/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalledWith(
				"project-a",
				expect.objectContaining({
					assetIndex: 0,
					resourceType: "character",
					selected: true,
					sourceAssetIndex: 0,
					sourceTaskId: "task-first",
					taskId: "task-first",
					title: "陈远",
				}),
			);
		});
	});

	it("syncs document-selected generated images into selected project resources", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			id: "task-document-selected",
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					taskId: "task-document-selected",
					url: "/api/v1/media-assets/media-document-selected/content",
				},
			],
		};
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetKeys={["image:/api/v1/media-assets/media-document-selected/content"]}
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalledWith(
				"project-a",
				expect.objectContaining({
					resourceType: "character",
					selected: true,
					sourceAssetIndex: 0,
					sourceTaskId: "task-document-selected",
					taskId: "task-document-selected",
					title: "陈远",
				}),
			);
		});
	});

	it("retries document-selected image sync after project resource save fails", async () => {
		const selectedEntry: GenerationEntry = {
			...imageEntry,
			id: "task-document-selected",
			assets: [
				{
					kind: "image",
					mimeType: "image/png",
					taskId: "task-document-selected",
					url: "/api/v1/media-assets/media-document-selected/content",
				},
			],
		};
		generationApiMocks.updateSelectedGenerationAsset
			.mockRejectedValueOnce(new Error("backend unavailable"))
			.mockResolvedValueOnce({});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: selectedEntry.id,
			orderedGenerationEntries: [selectedEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		const view = render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetKeys={["image:/api/v1/media-assets/media-document-selected/content"]}
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		await waitFor(() => {
			expect(toastMocks.error).toHaveBeenCalledWith("backend unavailable");
		});

		view.rerender(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetKeys={["image:/api/v1/media-assets/media-document-selected/content"]}
				selectedAssetResourceId="section-chenyuan"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		await waitFor(() => {
			expect(generationApiMocks.updateSelectedGenerationAsset).toHaveBeenCalledTimes(2);
		});
	});

	it("uploads edited images and imports them into history without selecting them", async () => {
		const editedAsset: GenerationAsset = {
			kind: "image",
			mimeType: "image/png",
			slotIndex: 0,
			taskId: "edited-entry",
			title: "原图 编辑版",
			url: "/api/v1/media-assets/edited-media/content",
		};
		const importMediaAssetsToHistory = vi.fn().mockResolvedValue([
			{
				id: "edited-entry",
				assets: [editedAsset],
			},
		]);
		const mutateMediaAssets = vi.fn(async () => undefined);
		const onToggleAsset = vi.fn();
		const setActiveEntryId = vi.fn();
		const editableEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					base64: btoa("source"),
					mimeType: "image/png",
					title: "原图",
				},
			],
		};
		mediaApiMocks.uploadMediaAsset.mockResolvedValue({
			...mediaAsset,
			filename: "原图 编辑版.png",
			id: "edited-media",
			url: "/api/v1/media-assets/edited-media/content",
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: editableEntry.id,
			importMediaAssetsToHistory,
			mutateMediaAssets,
			orderedGenerationEntries: [editableEntry],
			setActiveEntryId,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				onToggleAsset={onToggleAsset}
				projectId="project-a"
				selectedAssetResourceId="section-chenyuan"
				selectedAssetSourceDocumentId="character-doc"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑图片" }));
		fireEvent.click(await screen.findByRole("button", { name: "保存编辑图" }));

		await waitFor(() => {
			expect(mediaApiMocks.uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "project-a");
			expect(importMediaAssetsToHistory).toHaveBeenCalledWith(
				[
					expect.objectContaining({
						id: "edited-media",
						url: "/api/v1/media-assets/edited-media/content",
					}),
				],
				{
					assetTitle: "原图 编辑版",
					prompt: "旧提示词",
				},
			);
		});

		const uploadedFile = mediaApiMocks.uploadMediaAsset.mock.calls[0]?.[0] as File;
		expect(uploadedFile.name).toBe("原图 编辑版.png");
		expect(uploadedFile.type).toBe("image/png");
		expect(editedAsset.title).toBe("原图 编辑版");
		expect(mutateMediaAssets).toHaveBeenCalled();
		expect(onToggleAsset).not.toHaveBeenCalled();
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
		expect(setActiveEntryId).toHaveBeenCalledWith("edited-entry");
	});

	it("does not persist edited image selection in uncontrolled project mode", async () => {
		const editedAsset: GenerationAsset = {
			kind: "image",
			mimeType: "image/png",
			slotIndex: 0,
			taskId: "edited-entry",
			title: "原图 编辑版",
			url: "/api/v1/media-assets/edited-media/content",
		};
		const importMediaAssetsToHistory = vi.fn().mockResolvedValue([
			{
				id: "edited-entry",
				assets: [editedAsset],
			},
		]);
		const setActiveEntryId = vi.fn();
		const editableEntry: GenerationEntry = {
			...imageEntry,
			assets: [
				{
					kind: "image",
					base64: btoa("source"),
					mimeType: "image/png",
					title: "原图",
				},
			],
		};
		mediaApiMocks.uploadMediaAsset.mockResolvedValue({
			...mediaAsset,
			filename: "原图 编辑版.png",
			id: "edited-media",
			url: "/api/v1/media-assets/edited-media/content",
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: editableEntry.id,
			importMediaAssetsToHistory,
			orderedGenerationEntries: [editableEntry],
			setActiveEntryId,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				projectId="project-a"
				selectedAssetResourceId="section-chenyuan"
				selectedAssetSourceDocumentId="character-doc"
				selectedAssetTitle="陈远"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑图片" }));
		fireEvent.click(await screen.findByRole("button", { name: "保存编辑图" }));

		await waitFor(() => {
			expect(setActiveEntryId).toHaveBeenCalledWith("edited-entry");
		});
		expect(generationApiMocks.updateSelectedGenerationAsset).not.toHaveBeenCalled();
	});

	it("imports selected material library images only after confirmation", async () => {
		const importMediaAssetsToHistory = vi.fn().mockResolvedValue([{ id: "imported-entry" }]);
		const onMaterialLibraryImportOpenChange = vi.fn();
		const onToggleAsset = vi.fn();
		const setActiveEntryId = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			importMediaAssetsToHistory,
			orderedGenerationEntries: [],
			setActiveEntryId,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				materialLibraryImportOpen
				onMaterialLibraryImportOpenChange={onMaterialLibraryImportOpenChange}
				onToggleAsset={onToggleAsset}
				selectedAssetTitle="主角 底层青年 / 低阶散修"
				viewMode="history"
			/>,
		);

		expect(screen.getByRole("dialog", { name: "从素材库中选择" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: /source.png/ }));

		expect(importMediaAssetsToHistory).not.toHaveBeenCalled();
		expect(onToggleAsset).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "加入生成记录" }));

		await waitFor(() => {
			expect(importMediaAssetsToHistory).toHaveBeenCalledWith([mediaAsset], {
				assetTitle: "主角 底层青年 / 低阶散修",
			});
		});
		expect(onToggleAsset).not.toHaveBeenCalled();
		expect(setActiveEntryId).toHaveBeenCalledWith("imported-entry");
		expect(onMaterialLibraryImportOpenChange).toHaveBeenCalledWith(false);
	});

	it("imports selected material library videos in video generation", async () => {
		const importMediaAssetsToHistory = vi.fn().mockResolvedValue([{ id: "imported-video-entry" }]);
		const onMaterialLibraryImportOpenChange = vi.fn();
		const setActiveEntryId = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			importMediaAssetsToHistory,
			kind: "video",
			mediaAssets: [mediaAsset, videoMediaAsset],
			orderedGenerationEntries: [],
			setActiveEntryId,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="视频提示词"
				kind="video"
				materialLibraryImportOpen
				onMaterialLibraryImportOpenChange={onMaterialLibraryImportOpenChange}
				selectedAssetTitle="第 01 组"
				viewMode="history"
			/>,
		);

		expect(screen.getByRole("dialog", { name: "从素材库中选择" })).toBeTruthy();
		expect(screen.getByText("scene.mp4")).toBeTruthy();
		expect(screen.queryByText("source.png")).toBeNull();
		expect(screen.getByLabelText("上传视频素材")).toBeTruthy();
		expect(screen.queryByLabelText("上传图片素材")).toBeNull();

		fireEvent.click(screen.getByRole("checkbox", { name: /scene\.mp4/u }));
		fireEvent.click(screen.getByRole("button", { name: "加入生成记录" }));

		await waitFor(() => {
			expect(importMediaAssetsToHistory).toHaveBeenCalledWith([videoMediaAsset], {
				assetTitle: "第 01 组",
			});
		});
		expect(setActiveEntryId).toHaveBeenCalledWith("imported-video-entry");
		expect(onMaterialLibraryImportOpenChange).toHaveBeenCalledWith(false);
	});

	it("uploads material library images from the import dialog before confirmation", async () => {
		const uploadedAsset: MediaAsset = {
			...mediaAsset,
			id: "uploaded-media",
			filename: "uploaded.png",
			url: "/api/v1/media-assets/uploaded-media/content",
		};
		const importMediaAssetsToHistory = vi.fn().mockResolvedValue([{ id: "uploaded-entry" }]);
		const mutateMediaAssets = vi.fn();
		mediaApiMocks.uploadMediaAsset.mockResolvedValue(uploadedAsset);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			importMediaAssetsToHistory,
			mutateMediaAssets,
			orderedGenerationEntries: [],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				materialLibraryImportOpen
				onMaterialLibraryImportOpenChange={vi.fn()}
				projectId="project-a"
				viewMode="history"
			/>,
		);

		const file = new File(["image"], "uploaded.png", { type: "image/png" });
		fireEvent.change(screen.getByLabelText("上传图片素材"), {
			target: { files: [file] },
		});

		await waitFor(() => {
			expect(mediaApiMocks.uploadMediaAsset).toHaveBeenCalledWith(file, "project-a");
		});
		expect(mutateMediaAssets).toHaveBeenCalled();
		expect(await screen.findByText("uploaded.png")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "加入生成记录" }));

		await waitFor(() => {
			expect(importMediaAssetsToHistory).toHaveBeenCalledWith([uploadedAsset], {
				assetTitle: undefined,
			});
		});
	});

	it("does not treat document selection as material library import selection", () => {
		const onMaterialLibraryImportOpenChange = vi.fn();
		const onToggleAsset = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			orderedGenerationEntries: [imageEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				materialLibraryImportOpen
				onMaterialLibraryImportOpenChange={onMaterialLibraryImportOpenChange}
				onToggleAsset={onToggleAsset}
				selectedAssetKeys={["image:/api/v1/media-assets/media-a/content"]}
				viewMode="history"
			/>,
		);

		const materialCheckbox = screen.getByRole("checkbox", { name: /source.png/ });
		expect(materialCheckbox.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(materialCheckbox);
		expect(materialCheckbox.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(materialCheckbox);
		expect(materialCheckbox.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(screen.getByRole("button", { name: "加入生成记录" }));

		expect(workspaceDefaults.importMediaAssetsToHistory).not.toHaveBeenCalled();
		expect(onToggleAsset).not.toHaveBeenCalled();
		expect(onMaterialLibraryImportOpenChange).toHaveBeenCalledWith(false);
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

		fireEvent.click(screen.getAllByRole("button", { name: "使用此提示词" })[0]);

		expect(setPrompt).toHaveBeenCalledWith("旧提示词");
		expect(onViewModeChange).not.toHaveBeenCalled();
	});

	it("fills the prompt from a prompt pack when the editor is empty", () => {
		const setPrompt = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			prompt: "",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(<MediaGenerationWorkspace historyScopeId="history-a" initialPrompt="" kind="image" />);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		fireEvent.click(screen.getByRole("button", { name: "优化" }));

		expect(setPrompt).toHaveBeenCalledWith("cinematic lighting, detailed composition");
		expect(generationApiMocks.streamGenerationText).not.toHaveBeenCalled();
	});

	it("optimizes the current prompt with a selected prompt pack", async () => {
		const setPrompt = vi.fn();
		generationApiMocks.streamGenerationText.mockImplementation(async (_request, handlers) => {
			handlers.onDelta?.("optimized ");
			handlers.onDelta?.("prompt");
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: textGenerationCatalog,
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				conversationTitle="舔狗金 · 图片"
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
				projectId="project-a"
				taskType="character"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "优化" })).toBeEnabled());
		fireEvent.click(screen.getByRole("button", { name: "优化" }));

		await waitFor(() => expect(generationApiMocks.streamGenerationText).toHaveBeenCalled());
		expect(generationApiMocks.createGenerationConversation).toHaveBeenCalledWith({
			id: "project-a-text",
			kind: "text",
			scopeId: "agent",
			title: "舔狗金 · 提示词生成",
		});
		const [request] = generationApiMocks.streamGenerationText.mock.calls[0];
		expect(request.prompt).toContain("优化 prompt：\ncinematic lighting, detailed composition");
		expect(request.prompt).toContain("用户的输入：\n原始角色提示词");
		expect(request.prompt).toContain("请按“优化 prompt”的风格和质量要求改写“用户的输入”");
		expect(request.prompt).toContain("只输出优化后的提示词正文");
		expect(request.prompt).not.toContain("输出要求");
		expect(request.prompt).not.toContain("赛璐珞");
		expect(request).toMatchObject({
			capabilityId: "character",
			conversationId: "project-a-text",
			kind: "text",
			projectId: "project-a",
			routeId: "text-route",
			scopeId: "agent",
			provider: "openai",
			model: "text-model",
			params: {
				system_instruction: expect.stringContaining("只输出优化后的提示词正文"),
			},
		});
		expect(String((request.params as Record<string, unknown>).system_instruction)).toContain(
			"严格保持原有媒介与画风",
		);
		expect(setPrompt).toHaveBeenCalledWith("optimized");
		expect(setPrompt).toHaveBeenCalledWith("optimized prompt");
	});

	it("lists and resolves a protected prompt pack without exposing its body", async () => {
		const protectedPromptItem = {
			...promptInsertItem,
			id: "protected-cinematic",
			name: "受保护电影质感",
			prompt: "",
		};
		generationApiMocks.streamGenerationText.mockImplementation(async (_request, handlers) => {
			handlers.onDelta?.("optimized protected prompt");
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: textGenerationCatalog,
			prompt: "原始视频提示词",
			promptReferenceItems: [protectedPromptItem],
			setPrompt: vi.fn(),
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始视频提示词"
				kind="video"
				projectId="project-a"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /受保护电影质感/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "优化" })).toBeEnabled());
		fireEvent.click(screen.getByRole("button", { name: "优化" }));

		await waitFor(() => expect(generationApiMocks.streamGenerationText).toHaveBeenCalled());
		const [request] = generationApiMocks.streamGenerationText.mock.calls[0];
		expect(request).toMatchObject({
			prompt: "原始视频提示词",
			promptOptimization: {
				model: "text-model",
				referenceId: "protected-cinematic",
				referenceName: "受保护电影质感",
				referencePrompt: "",
				routeId: "text-route",
			},
		});
		expect(JSON.stringify(request)).not.toContain("cinematic lighting, detailed composition");
	});

	it("submits prompt optimization settings when optimizing and generating", async () => {
		const setPrompt = vi.fn();
		const submitGeneration = vi.fn(async () => undefined);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: textGenerationCatalog,
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
			submitGeneration,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWithIsolatedSWR(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
				projectId="project-a"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "优化并生成" })).toBeEnabled());
		fireEvent.click(screen.getByRole("button", { name: "优化并生成" }));

		await waitFor(() =>
			expect(submitGeneration).toHaveBeenCalledWith({
				prompt: "原始角色提示词",
				promptOptimization: expect.objectContaining({
					capabilityId: "studio",
					conversationTitle: "项目 · 提示词生成",
					model: "text-model",
					projectId: "project-a",
					referenceName: "电影质感",
					referencePrompt: "cinematic lighting, detailed composition",
					routeId: "text-route",
					scopeId: "agent",
					sessionId: "project-a-text",
				}),
				sourceRefs: [],
			}),
		);
		expect(generationApiMocks.streamGenerationText).not.toHaveBeenCalled();
		expect(setPrompt).not.toHaveBeenCalledWith("optimized ");
		expect(setPrompt).not.toHaveBeenCalledWith("optimized prompt");
	});

	it("submits server-side prompt optimization without loading prompt template instructions", async () => {
		const setPrompt = vi.fn();
		const submitGeneration = vi.fn(async () => undefined);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: textGenerationCatalog,
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
			submitGeneration,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWithIsolatedSWR(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
				projectId="project-a"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "优化并生成" })).toBeEnabled());
		fireEvent.click(screen.getByRole("button", { name: "优化并生成" }));

		await waitFor(() =>
			expect(submitGeneration).toHaveBeenCalledWith({
				prompt: "原始角色提示词",
				promptOptimization: expect.objectContaining({
					capabilityId: "studio",
					conversationTitle: "项目 · 提示词生成",
					model: "text-model",
					projectId: "project-a",
					referenceName: "电影质感",
					referencePrompt: "cinematic lighting, detailed composition",
					routeId: "text-route",
					scopeId: "agent",
					sessionId: "project-a-text",
				}),
				sourceRefs: [],
			}),
		);
		expect(setPrompt).not.toHaveBeenCalledWith(
			"原始角色提示词\n\ncinematic lighting, detailed composition",
		);
		expect(generationApiMocks.streamGenerationText).not.toHaveBeenCalled();
	});

	it("does not directly generate from optimize-and-generate when no text route is available", () => {
		const setPrompt = vi.fn();
		const submitGeneration = vi.fn(async () => undefined);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: {
				families: [{ id: "image-family", kind: "image", label: "图像模型" }],
				models: [],
				providers: [],
				routes: [workspaceDefaults.selectedRoute],
				versions: [{ id: "version-image", kind: "image", label: "v1" }],
			},
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
			submitGeneration,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWithIsolatedSWR(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
				projectId="project-a"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));

		const optimizeAndGenerate = screen.getByRole("button", { name: "优化并生成" });
		expect(optimizeAndGenerate).toBeDisabled();
		fireEvent.click(optimizeAndGenerate);

		expect(submitGeneration).not.toHaveBeenCalled();
		expect(setPrompt).not.toHaveBeenCalledWith(
			"原始角色提示词\n\ncinematic lighting, detailed composition",
		);
	});

	it("uses the selected text model for prompt optimization", async () => {
		const setPrompt = vi.fn();
		generationApiMocks.streamGenerationText.mockImplementation(async (_request, handlers) => {
			handlers.onDelta?.("optimized prompt");
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			catalog: textGenerationCatalog,
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWithIsolatedSWR(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
				projectId="project-a"
			/>,
		);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "优化提示词" })).toHaveAttribute(
				"title",
				"优化提示词",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		const optimizeRouteButton = screen
			.getAllByRole("button", {
				name: "模型版本和供应商",
			})
			.at(-1);
		if (!optimizeRouteButton) throw new Error("missing prompt optimize model route button");
		fireEvent.click(optimizeRouteButton);
		fireEvent.click(screen.getByRole("button", { name: /DMX Text v1/ }));
		fireEvent.click(screen.getByRole("button", { name: "DMX" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "优化" })).toBeEnabled());
		fireEvent.click(screen.getByRole("button", { name: "优化" }));

		await waitFor(() => expect(generationApiMocks.streamGenerationText).toHaveBeenCalled());
		const [request] = generationApiMocks.streamGenerationText.mock.calls[0];
		expect(request).toMatchObject({
			kind: "text",
			model: "dmx-text-model",
			provider: "dmx",
			routeId: "text-route-dmx",
			versionId: "text-version-dmx",
		});
	});

	it("appends a prompt pack when no text model is available for optimization", () => {
		const setPrompt = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			prompt: "原始角色提示词",
			promptReferenceItems: [promptInsertItem],
			setPrompt,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="原始角色提示词"
				kind="image"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("button", { name: /电影质感/ }));
		fireEvent.click(screen.getByRole("button", { name: "优化" }));

		const updater = setPrompt.mock.calls.find(([value]) => typeof value === "function")?.[0];
		expect(typeof updater).toBe("function");
		expect(updater("原始角色提示词")).toBe(
			"原始角色提示词\n\ncinematic lighting, detailed composition",
		);
		expect(toastMocks.warning).toHaveBeenCalledWith("没有可用文本模型", {
			description: "已追加技能包内容。",
		});
		expect(generationApiMocks.streamGenerationText).not.toHaveBeenCalled();
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

		fireEvent.click(screen.getAllByRole("button", { name: "使用此提示词" })[0]);

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

	it("adds selected node shortcut images to reference urls", () => {
		const workspaceOptions: Array<Parameters<typeof useGenerationWorkspace>[0]> = [];
		const nodeReference: MediaAsset = {
			id: "document-section-image:scene-a",
			kind: "image",
			filename: "第 01 组 · 图片 1",
			mimeType: "image/png",
			sizeBytes: 0,
			url: "/api/v1/media-assets/scene-a/content",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};

		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions.push(options);
			return workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				referenceShortcutGroups={[
					{
						id: "selected-nodes",
						title: "已选节点图片",
						items: [{ asset: nodeReference, title: "第 01 组" }],
					},
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "选择快捷参考 第 01 组" }));

		expect(screen.getByText("第 01 组 · 图片 1")).toBeTruthy();
		const latestOptions = workspaceOptions.at(-1);
		const referenceUrls =
			typeof latestOptions?.extraReferenceUrls === "function"
				? latestOptions.extraReferenceUrls("初始提示词")
				: (latestOptions?.extraReferenceUrls ?? []);
		expect(referenceUrls.some((url) => url.endsWith("/api/v1/media-assets/scene-a/content"))).toBe(
			true,
		);
	});

	it("normalizes extra reference urls before submitting them to generation", () => {
		const workspaceOptions: Array<Parameters<typeof useGenerationWorkspace>[0]> = [];
		vi.mocked(useGenerationWorkspace).mockImplementation((options) => {
			workspaceOptions.push(options);
			return workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>;
		});

		render(
			<MediaGenerationWorkspace
				extraReferenceUrls={["/api/v1/projects/project-a/media-assets/ref-a/content"]}
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
			/>,
		);

		const latestOptions = workspaceOptions.at(-1);
		const referenceUrls =
			typeof latestOptions?.extraReferenceUrls === "function"
				? latestOptions.extraReferenceUrls("初始提示词")
				: (latestOptions?.extraReferenceUrls ?? []);
		expect(referenceUrls).toContain(
			new URL(
				"/api/v1/projects/project-a/media-assets/ref-a/content",
				window.location.origin,
			).toString(),
		);
	});

	it("shows image delete failures as a toast instead of an input panel error", async () => {
		const deleteGenerationEntryAsset = vi
			.fn()
			.mockRejectedValue({ message: "generation task asset not found" });
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			deleteGenerationEntryAsset,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: "删除图片" })[0]);

		expect(deleteGenerationEntryAsset).not.toHaveBeenCalled();
		const dialog = screen.getByRole("alertdialog", { name: "删除这张图片？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		await waitFor(() => {
			expect(deleteGenerationEntryAsset).toHaveBeenCalledWith("entry-image", 0);
			expect(toastMocks.error).toHaveBeenCalledWith("删除失败", {
				description: "generation task asset not found",
			});
		});
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("removes imported material references from local history instead of deleting task assets", async () => {
		const deleteGenerationEntry = vi.fn().mockResolvedValue(true);
		const deleteGenerationEntryAsset = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: importedMaterialEntry.id,
			deleteGenerationEntry,
			deleteGenerationEntryAsset,
			orderedGenerationEntries: [importedMaterialEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "删除图片" }));
		const dialog = screen.getByRole("alertdialog", { name: "删除这张图片？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		await waitFor(() => {
			expect(deleteGenerationEntry).toHaveBeenCalledWith(importedMaterialEntry.id);
		});
		expect(deleteGenerationEntryAsset).not.toHaveBeenCalled();
	});

	it("uses video wording when a generated video asset cannot be deleted", async () => {
		const deleteGenerationEntryAsset = vi.fn().mockResolvedValue(false);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: "entry-video",
			deleteGenerationEntryAsset,
			kind: "video",
			orderedGenerationEntries: [videoEntry],
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				kind: "video",
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "删除视频" }));
		const dialog = screen.getByRole("alertdialog", { name: "删除这个视频？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		await waitFor(() => {
			expect(deleteGenerationEntryAsset).toHaveBeenCalledWith("entry-video", 0);
			expect(toastMocks.error).toHaveBeenCalledWith("删除失败", {
				description: "找不到可删除的生成视频。",
			});
		});
	});

	it("deletes failed video placeholders through the placeholder slot action", async () => {
		const deleteGenerationEntry = vi.fn();
		const deleteGenerationEntryAsset = vi.fn();
		const deleteGenerationEntryAssetPlaceholder = vi.fn().mockResolvedValue(true);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: "local-123:error",
			deleteGenerationEntry,
			deleteGenerationEntryAsset,
			deleteGenerationEntryAssetPlaceholder,
			kind: "video",
			orderedGenerationEntries: [failedVideoEntry],
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				kind: "video",
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
				viewMode="history"
			/>,
		);

		fireEvent.contextMenu(screen.getByRole("img", { name: /生成失败/ }));
		const menu = await screen.findByRole("menu");
		fireEvent.click(within(menu).getByRole("menuitem", { name: "删除" }));
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这个视频？" })).getByRole("button", {
				name: "删除",
			}),
		);

		await waitFor(() => {
			expect(deleteGenerationEntryAssetPlaceholder).toHaveBeenCalledWith("local-123:error", 0);
		});
		expect(deleteGenerationEntryAsset).not.toHaveBeenCalled();
		expect(deleteGenerationEntry).not.toHaveBeenCalled();
		expect(toastMocks.error).not.toHaveBeenCalledWith("删除失败", {
			description: "找不到可删除的生成视频。",
		});
	});

	it("downloads generated videos with the selected section title", async () => {
		const videoWithPlaceholderTitle: GenerationEntry = {
			...videoEntry,
			assets: [
				{
					downloadPath: "/tmp/a.mp4",
					kind: "video",
					mimeType: "video/mp4",
					title: "a",
					url: "/api/v1/media-assets/video-a/content",
				},
			],
		};
		desktopActionMocks.pickDesktopDirectory.mockResolvedValue("/Users/me/Exports");
		desktopActionMocks.copyDesktopFileToDirectory.mockResolvedValue({
			filename: "第 01 组 总时长：00 08.mp4",
			path: "/Users/me/Exports/第 01 组 总时长：00 08.mp4",
		});
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: "entry-video",
			kind: "video",
			orderedGenerationEntries: [videoWithPlaceholderTitle],
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				kind: "video",
			},
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="video"
				selectedAssetTitle="第 01 组 总时长：00:08"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "下载视频" }));

		await waitFor(() => {
			expect(desktopActionMocks.copyDesktopFileToDirectory).toHaveBeenCalledWith({
				directory: "/Users/me/Exports",
				filename: "第 01 组 总时长：00 08.mp4",
				sourcePath: "/tmp/a.mp4",
			});
		});
	});

	it("deletes only the selected pending image slot from tabbed history", async () => {
		const deleteGenerationEntry = vi.fn();
		const deleteGenerationEntryAssetPlaceholder = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			activeEntryId: "entry-pending-image",
			deleteGenerationEntry,
			deleteGenerationEntryAssetPlaceholder,
			orderedGenerationEntries: [pendingImageEntry],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<MediaGenerationWorkspace
				historyScopeId="history-a"
				initialPrompt="初始提示词"
				kind="image"
				viewMode="history"
			/>,
		);

		fireEvent.contextMenu(screen.getAllByRole("img", { name: /生成中/ })[0]);
		const menu = await screen.findByRole("menu");
		fireEvent.click(within(menu).getByRole("menuitem", { name: "删除" }));
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这张图片？" })).getByRole("button", {
				name: "删除",
			}),
		);

		expect(deleteGenerationEntryAssetPlaceholder).toHaveBeenCalledWith("entry-pending-image", 0);
		expect(deleteGenerationEntry).not.toHaveBeenCalled();
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

		expect(
			screen.getAllByText("质量").some((element) => !element.classList.contains("sr-only")),
		).toBe(true);
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
