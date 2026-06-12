import { cleanup, render, screen } from "@testing-library/react";
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
		default: "720p",
		options: [
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
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
		id: "route-image",
		kind: "image",
		model: "image-model",
		params: imageParams,
		status: "available",
		supportsReferenceUrls: true,
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
	updateParam: vi.fn(),
	updateRoute: vi.fn(),
	updateVersion: vi.fn(),
	uploadIdPrefix: "generation",
	uploadReferenceAsset: vi.fn(),
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

	it("shows image spec control in the studio composer and keeps only other params in settings", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue(
			workspaceDefaults as unknown as ReturnType<typeof useGenerationWorkspace>,
		);

		renderWorkspace();

		expect(screen.getByRole("button", { name: /图像规格/ })).toBeTruthy();
		expect(screen.getByText("质量")).toBeTruthy();
		expect(screen.queryByText("画幅比例")).toBeNull();
		expect(screen.queryByText("图像尺寸")).toBeNull();
	});

	it("does not migrate video ratio and resolution params", () => {
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			...workspaceDefaults,
			kind: "video",
			selectedRoute: {
				...workspaceDefaults.selectedRoute,
				id: "route-video",
				kind: "video",
				model: "video-model",
				params: videoParams,
			},
			selectedParams: {
				ratio: "16:9",
				resolution: "720p",
			},
			selectedVersion: { id: "version-video", label: "Video 1" },
			visibleVersions: [{ id: "version-video", label: "Video 1" }],
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		renderWorkspace();

		expect(screen.queryByRole("button", { name: /图像规格/ })).toBeNull();
		expect(screen.getByText("比例")).toBeTruthy();
		expect(screen.getByText("分辨率")).toBeTruthy();
	});
});
