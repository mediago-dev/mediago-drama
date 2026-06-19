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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
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
	selectedGenerationAssetsQueryKey: vi.fn((projectId: string) => [
		"generation-selected-assets",
		projectId,
	]),
	updateGenerationTaskAsset: vi.fn(async () => undefined),
}));
const mediaApiMocks = vi.hoisted(() => ({
	uploadMediaAsset: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();

	return {
		...actual,
		selectedGenerationAssetsQueryKey: generationApiMocks.selectedGenerationAssetsQueryKey,
		updateGenerationTaskAsset: generationApiMocks.updateGenerationTaskAsset,
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
		referenceButtonLabel,
		secondaryParamControls,
	}: {
		error?: string | null;
		imageSpecControl?: React.ReactNode;
		modelControls?: React.ReactNode;
		previewReferenceAssets?: MediaAsset[];
		primaryParamControls?: React.ReactNode;
		promptEditor?: React.ReactNode;
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

const render = (ui: React.ReactElement) =>
	testingRender(
		<>
			{ui}
			<ConfirmDialog />
		</>,
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

const workspaceDefaults = {
	activeEntryId: "entry-image",
	addEditedGenerationEntry: vi.fn(),
	canSubmit: true,
	composerLayers: [],
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
				selectedAssetTitle="主角 底层青年 / 低阶散修"
				taskType="character"
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入结果" }));

		await waitFor(() => {
			expect(generationApiMocks.updateGenerationTaskAsset).toHaveBeenCalledWith("task-a", 2, {
				resourceType: "character",
				selected: true,
				title: "主角 底层青年 / 低阶散修",
			});
		});
	});

	it("uploads edited images to the media library instead of storing base64 in history", async () => {
		const addEditedGenerationEntry = vi.fn(
			(_options: { asset: GenerationAsset }) => "edited-entry",
		);
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
			addEditedGenerationEntry,
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
				viewMode="history"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑图片" }));
		fireEvent.click(await screen.findByRole("button", { name: "保存编辑图" }));

		await waitFor(() => {
			expect(mediaApiMocks.uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "project-a");
			expect(addEditedGenerationEntry).toHaveBeenCalled();
		});

		const uploadedFile = mediaApiMocks.uploadMediaAsset.mock.calls[0]?.[0] as File;
		expect(uploadedFile.name).toBe("原图 编辑版.png");
		expect(uploadedFile.type).toBe("image/png");
		const editedAsset = addEditedGenerationEntry.mock.calls[0]?.[0].asset;
		expect(editedAsset).toEqual(
			expect.objectContaining({
				kind: "image",
				mimeType: "image/png",
				selected: true,
				title: "原图 编辑版",
				url: "/api/v1/media-assets/edited-media/content",
			}),
		);
		expect(editedAsset.base64).toBeUndefined();
		expect(mutateMediaAssets).toHaveBeenCalled();
		expect(onToggleAsset).toHaveBeenCalledWith(editedAsset, true);
		expect(setActiveEntryId).toHaveBeenCalledWith("edited-entry");
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
