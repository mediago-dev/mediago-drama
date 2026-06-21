import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { GenerationWorkspace } from "./GenerationWorkspace";

const generationApiMocks = vi.hoisted(() => ({
	previewGenerationVoice: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	success: vi.fn(),
	warning: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("@/domains/generation/api/generation", () => ({
	generationModelsKey: "/generation/models",
	previewGenerationVoice: generationApiMocks.previewGenerationVoice,
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => toastMocks,
}));

vi.mock("@/domains/generation/components/GenerationChatPanel", () => ({
	GenerationChatPanel: () => <div data-testid="generation-chat-panel" />,
}));

vi.mock("@/domains/generation/components/GenerationSetupNotice", () => ({
	GenerationSetupNotice: () => <div data-testid="setup-notice" />,
	InspectorHeading: ({ title }: { title: string }) => <h2>{title}</h2>,
	ModeToggle: () => <div data-testid="mode-toggle" />,
}));

vi.mock("@/domains/generation/components/MaterialLibrary", () => ({
	MaterialLibrary: () => <div data-testid="material-library" />,
}));

vi.mock("@/domains/generation/components/ReferencePreviewStrip", () => ({
	ReferencePreviewStrip: () => null,
}));

vi.mock("@/domains/generation/components/generatedResultActions", () => ({
	useGeneratedResultActions: () => ({
		canSaveText: false,
		copyPrompt: vi.fn(),
		saveAsset: vi.fn(),
		saveText: vi.fn(),
		savedKeys: new Set(),
		savingKeys: new Set(),
	}),
}));

const imageParams = [
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
	{
		name: "quality",
		label: "质量",
		type: "select",
		default: "high",
		options: [
			{ label: "高", value: "high" },
			{ label: "低", value: "low" },
		],
	},
	{ name: "n", label: "图像数量", type: "number", default: 1, min: 1, max: 4 },
];

const videoParams = [
	{
		name: "ratio",
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
];

const audioVoiceParam = {
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
	activeEntry: null,
	activeEntryId: null,
	activeMediaAssetId: null,
	canSubmit: true,
	error: null,
	filteredMediaAssets: [],
	fullPrompt: "",
	generationEntries: [],
	hasConfiguredRoutesForKind: true,
	hasLiveCatalog: true,
	isSubmitting: false,
	isUploadingAsset: false,
	kind: "image",
	mediaAssets: [],
	mediaKindFilter: "all",
	mediaQuery: "",
	mutateMediaAssets: vi.fn(),
	prompt: "",
	promptInsertItems: [],
	referenceCount: 0,
	refreshVideo: vi.fn(),
	removeMediaAsset: vi.fn(),
	renameMediaAsset: vi.fn(),
	selectableReferenceKinds: new Set(["image"]),
	selectedFamily: { id: "image-family", label: "图像" },
	selectedReferenceAssetIds: [],
	selectedReferenceAssets: [],
	selectedRoute: {
		adapter: "test",
		configured: true,
		docUrl: "https://example.com",
		familyId: "image-family",
		id: "route-image",
		kind: "image",
		label: "Image Route",
		model: "image-model",
		params: imageParams,
		provider: "openai",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "version-image",
	},
	selectedParams: {
		aspectRatio: "1:1",
		imageSize: "2K",
		n: 1,
		quality: "high",
	},
	selectedVersion: { id: "version-image", label: "Image 1" },
	setActiveEntryId: vi.fn(),
	setKind: vi.fn(),
	setMediaKindFilter: vi.fn(),
	setMediaQuery: vi.fn(),
	setPrompt: vi.fn(),
	submit: vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault()),
	toggleReferenceAsset: vi.fn(),
	updateFamily: vi.fn(),
	updateModelRoute: vi.fn(),
	updateParam: vi.fn(),
	updateRoute: vi.fn(),
	updateVersion: vi.fn(),
	uploadIdPrefix: "generation",
	uploadReferenceAsset: vi.fn(),
	visibleFamilyRoutes: [
		{
			adapter: "test",
			configured: true,
			docUrl: "https://example.com",
			familyId: "image-family",
			id: "route-image",
			kind: "image",
			label: "Image Route",
			model: "image-model",
			params: imageParams,
			provider: "openai",
			status: "available",
			supportsReferenceUrls: true,
			versionId: "version-image",
		},
	],
	visibleFamilies: [{ id: "image-family", label: "图像" }],
	visibleRoutes: [],
	visibleVersions: [{ id: "version-image", label: "Image 1" }],
};

const renderWorkspace = () =>
	render(
		<MemoryRouter>
			<GenerationWorkspace initialKind="image" />
		</MemoryRouter>,
	);

describe("GenerationWorkspace image spec control", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		generationApiMocks.previewGenerationVoice.mockResolvedValue({
			asset: {
				kind: "audio",
				mimeType: "audio/mpeg",
				url: "/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/male-qn-jingying",
			},
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("shows image spec control in the studio composer and keeps secondary params behind other", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		renderWorkspace();

		expect(screen.getByRole("button", { name: /图片大小/ })).toBeTruthy();
		expect(screen.queryByText("质量")).toBeNull();
		expect(screen.queryByText("画幅比例")).toBeNull();
		expect(screen.queryByText("图像尺寸")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "其他" }));

		expect(
			screen.getAllByText("质量").some((element) => !element.classList.contains("sr-only")),
		).toBe(true);
		expect(screen.queryByText("画幅比例")).toBeNull();
		expect(screen.queryByText("图像尺寸")).toBeNull();
	});

	it("opens the reference material library from the composer add button", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		renderWorkspace();

		fireEvent.click(screen.getByRole("button", { name: "选择参考素材" }));

		expect(screen.getByRole("dialog", { name: "选择参考图" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "上传" })).toBeTruthy();
	});

	it("keeps the studio prompt editor between 2 and 9 rows", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		const { container } = renderWorkspace();

		expect(
			container.querySelector("[class*='generation-composer-textarea-min-height']"),
		).toBeTruthy();
		expect(
			container.querySelector("[class*='generation-composer-textarea-max-height']"),
		).toBeTruthy();
		expect(container.querySelector(".resize-y")).toBeNull();
	});

	it("moves video ratio, resolution, and duration into primary controls", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			kind: "video",
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				id: "route-video",
				kind: "video",
				model: "video-model",
				params: videoParams,
				provider: "jimeng",
				versionId: "version-video",
			},
			selectedParams: {
				ratio: "16:9",
				resolution: "720p",
				duration: "5",
			},
			selectedVersion: { id: "version-video", label: "Video 1" },
			visibleFamilyRoutes: [
				{
					...workspaceDefaults.selectedRoute,
					id: "route-video",
					kind: "video",
					model: "video-model",
					params: videoParams,
					provider: "jimeng",
					versionId: "version-video",
				},
			],
			visibleVersions: [{ id: "version-video", label: "Video 1" }],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWorkspace();

		expect(screen.getByRole("button", { name: /视频大小/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: "秒数：5 秒" })).toBeTruthy();
		expect(screen.queryByText("比例")).toBeNull();
		expect(screen.queryByText("分辨率")).toBeNull();
		expect(screen.queryByText("时长")).toBeNull();
	});

	it("shows and plays local voice previews in the studio audio composer", async () => {
		const originalAudio = globalThis.Audio;
		const playMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const pauseMock = vi.fn();

		class MockAudio {
			src: string;

			constructor(src?: string) {
				this.src = src ?? "";
			}

			play = playMock;
			pause = pauseMock;
		}

		Object.defineProperty(globalThis, "Audio", {
			configurable: true,
			value: MockAudio,
			writable: true,
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
				id: "official.minimax-speech-2.8-turbo",
				kind: "audio",
				model: "speech-2.8-turbo",
				params: [audioVoiceParam],
				provider: "minimax",
				supportsReferenceUrls: false,
				versionId: "minimax-speech-2.8-turbo",
			},
			selectedVersion: { id: "minimax-speech-2.8-turbo", label: "Minimax-speech-2.8-turbo" },
			visibleFamilies: [{ id: "minimax-speech", label: "MiniMax 国内 Speech" }],
			visibleFamilyRoutes: [
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
			visibleVersions: [{ id: "minimax-speech-2.8-turbo", label: "Minimax-speech-2.8-turbo" }],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		try {
			renderWorkspace();

			fireEvent.click(screen.getByRole("button", { name: "音色：中文 (普通话) · 少女音色" }));
			await screen.findByRole("dialog", { name: "音色" });
			fireEvent.click(screen.getByRole("button", { name: "预览 中文 (普通话) · 精英青年音色" }));

			await waitFor(() => {
				expect(generationApiMocks.previewGenerationVoice).toHaveBeenCalledWith({
					routeId: "official.minimax-speech-2.8-turbo",
					voiceId: "male-qn-jingying",
				});
			});
			expect(playMock).toHaveBeenCalledTimes(1);
			fireEvent.click(
				await screen.findByRole("button", { name: "暂停 中文 (普通话) · 精英青年音色" }),
			);
			expect(generationApiMocks.previewGenerationVoice).toHaveBeenCalledTimes(1);
			expect(pauseMock).toHaveBeenCalledTimes(1);
		} finally {
			Object.defineProperty(globalThis, "Audio", {
				configurable: true,
				value: originalAudio,
				writable: true,
			});
		}
	});
});
