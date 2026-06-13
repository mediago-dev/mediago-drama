import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { GenerationWorkspace } from "./GenerationWorkspace";

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/components/GenerationChatPanel", () => ({
	GenerationChatPanel: () => <div data-testid="generation-chat-panel" />,
}));

vi.mock("@/domains/generation/components/GenerationInspectorResize", () => ({
	GenerationInspectorResizeHandle: () => null,
	useGenerationInspectorWidth: () => [360, vi.fn()],
}));

vi.mock("@/domains/generation/components/GenerationSetupNotice", () => ({
	GenerationSetupNotice: () => <div data-testid="setup-notice" />,
	InspectorHeading: ({ title }: { title: string }) => <h2>{title}</h2>,
	ModeToggle: () => <div data-testid="mode-toggle" />,
}));

vi.mock("@/domains/generation/components/MaterialLibrary", () => ({
	MaterialLibrary: () => <div data-testid="material-library" />,
}));

vi.mock("@/domains/generation/components/PromptLibraryPicker", () => ({
	PromptLibraryPicker: () => null,
}));

vi.mock("@/domains/generation/components/LayeredPromptComposer", () => ({
	LayeredPromptComposer: () => null,
}));

vi.mock("@/domains/generation/components/ReferencePreviewStrip", () => ({
	ReferencePreviewStrip: () => null,
}));

vi.mock("@/domains/generation/components/RouteSelectors", () => ({
	RouteSelectors: () => <div data-testid="route-selectors" />,
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

const workspaceDefaults = {
	activeEntry: null,
	activeEntryId: null,
	activeMediaAssetId: null,
	canSubmit: true,
	composerLayers: [],
	error: null,
	filteredMediaAssets: [],
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
	setLayerSelection: vi.fn(),
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

		expect(screen.getByText("质量")).toBeTruthy();
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
});
