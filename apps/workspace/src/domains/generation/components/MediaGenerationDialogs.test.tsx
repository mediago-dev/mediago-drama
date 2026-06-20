import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationParam } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	MaterialLibraryImportDialog,
	PrimaryParamControl,
	ReferenceSelectionDialog,
	SecondaryParamsDropdown,
} from "./MediaGenerationDialogs";

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: "image-1",
	filename: "still.png",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	url: "/api/v1/media-assets/image-1/content",
	createdAt: "2026-06-12T00:00:00.000Z",
	updatedAt: "2026-06-12T00:00:00.000Z",
	...overrides,
});

const durationParam: GenerationParam = {
	name: "duration",
	label: "时长",
	type: "select",
	menu: "primary",
	default: "4",
	options: [
		{ label: "4 秒", value: "4" },
		{ label: "5 秒", value: "5" },
	],
};

const compressionParam: GenerationParam = {
	name: "outputCompression",
	label: "输出压缩",
	type: "number",
	menu: "secondary",
	default: 100,
	min: 0,
	max: 100,
};

const voiceParam: GenerationParam = {
	name: "voiceId",
	label: "音色",
	type: "select",
	menu: "primary",
	default: "Chinese (Mandarin)_Warm_Bestie",
	options: [
		{ label: "中文 (普通话) · 温暖闺蜜", value: "Chinese (Mandarin)_Warm_Bestie" },
		{ label: "中文 (普通话) · 播报男声", value: "Chinese (Mandarin)_Male_Announcer" },
		{ label: "英文 · Aussie Bloke", value: "English_Aussie_Bloke" },
	],
};

describe("ReferenceSelectionDialog", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		cleanup();
	});

	it("filters reference materials by all, video, image, and audio tabs", () => {
		render(
			<ReferenceSelectionDialog
				disabled={false}
				entries={[]}
				inputId="reference-upload"
				isUploading={false}
				mediaAssets={[
					mediaAsset(),
					mediaAsset({
						id: "video-1",
						filename: "scene.mp4",
						kind: "video",
						mimeType: "video/mp4",
						url: "/api/v1/media-assets/video-1/content",
					}),
					mediaAsset({
						id: "audio-1",
						filename: "audio.mp3",
						kind: "audio",
						mimeType: "audio/mpeg",
						url: "/api/v1/media-assets/audio-1/content",
					}),
				]}
				open
				references={[]}
				requiresReference={false}
				selectableKinds={new Set(["image", "video", "audio"])}
				selectedAssetIds={[]}
				onOpenChange={vi.fn()}
				onRefreshAssets={vi.fn()}
				onRemoveReference={vi.fn()}
				onToggleReference={vi.fn()}
				onUpload={vi.fn()}
			/>,
		);

		expect(screen.getByText("still.png")).toBeTruthy();
		expect(screen.getByText("scene.mp4")).toBeTruthy();
		expect(screen.getByText("audio.mp3")).toBeTruthy();
		expect(screen.getByRole("dialog", { name: "选择参考图" })).toBeTruthy();

		const videoTab = screen.getByRole("tab", { name: /视频/ });
		fireEvent.mouseDown(videoTab, { button: 0 });
		fireEvent.click(videoTab);

		expect(screen.queryByText("still.png")).toBeNull();
		expect(screen.getByText("scene.mp4")).toBeTruthy();
		expect(screen.queryByText("audio.mp3")).toBeNull();

		const imageTab = screen.getByRole("tab", { name: /图片/ });
		fireEvent.mouseDown(imageTab, { button: 0 });
		fireEvent.click(imageTab);

		expect(screen.getByText("still.png")).toBeTruthy();
		expect(screen.queryByText("scene.mp4")).toBeNull();
		expect(screen.queryByText("audio.mp3")).toBeNull();

		const audioTab = screen.getByRole("tab", { name: /音频/ });
		fireEvent.mouseDown(audioTab, { button: 0 });
		fireEvent.click(audioTab);

		expect(screen.queryByText("still.png")).toBeNull();
		expect(screen.queryByText("scene.mp4")).toBeNull();
		expect(screen.getByText("audio.mp3")).toBeTruthy();
	});

	it("renders audio references with a playback button instead of an image preview", async () => {
		const play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
		render(
			<ReferenceSelectionDialog
				disabled={false}
				entries={[]}
				inputId="reference-upload"
				isUploading={false}
				mediaAssets={[
					mediaAsset({
						id: "audio-1",
						filename: "audio.mp3",
						kind: "audio",
						mimeType: "audio/mpeg",
						url: "/api/v1/media-assets/audio-1/content",
					}),
				]}
				open
				references={[]}
				requiresReference={false}
				selectableKinds={new Set(["image"])}
				selectedAssetIds={[]}
				onOpenChange={vi.fn()}
				onRefreshAssets={vi.fn()}
				onRemoveReference={vi.fn()}
				onToggleReference={vi.fn()}
				onUpload={vi.fn()}
			/>,
		);

		expect(screen.getByText("audio.mp3")).toBeTruthy();
		expect(document.querySelector('img[src="/api/v1/media-assets/audio-1/content"]')).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "播放 audio.mp3" }));

		await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	});

	it("allows callers to label mixed video references as material", () => {
		render(
			<ReferenceSelectionDialog
				disabled={false}
				entries={[]}
				inputId="reference-upload"
				isUploading={false}
				mediaAssets={[]}
				open
				references={[]}
				requiresReference={false}
				selectableKinds={new Set(["image", "video"])}
				selectedAssetIds={[]}
				title="选择参考素材"
				onOpenChange={vi.fn()}
				onRefreshAssets={vi.fn()}
				onRemoveReference={vi.fn()}
				onToggleReference={vi.fn()}
				onUpload={vi.fn()}
			/>,
		);

		expect(screen.getByRole("dialog", { name: "选择参考素材" })).toBeTruthy();
	});

	it("renders selected node image shortcuts with section titles", () => {
		const onToggleShortcutReference = vi.fn();
		const nodeImage = mediaAsset({
			id: "node-image-1",
			filename: "node-image.png",
			url: "/api/v1/media-assets/node-image-1/content",
		});

		render(
			<ReferenceSelectionDialog
				disabled={false}
				entries={[]}
				inputId="reference-upload"
				isUploading={false}
				mediaAssets={[]}
				open
				references={[]}
				requiresReference={false}
				selectableKinds={new Set(["image"])}
				selectedAssetIds={[]}
				selectedShortcutAssetIds={["node-image-1"]}
				shortcutGroups={[
					{
						description: "来自《故事》",
						id: "selected-nodes",
						title: "已选节点图片",
						items: [
							{
								asset: nodeImage,
								subtitle: "第 1 张",
								title: "第 01 组",
							},
						],
					},
				]}
				onOpenChange={vi.fn()}
				onRefreshAssets={vi.fn()}
				onRemoveReference={vi.fn()}
				onToggleReference={vi.fn()}
				onToggleShortcutReference={onToggleShortcutReference}
				onUpload={vi.fn()}
			/>,
		);

		expect(screen.getByText("已选节点图片")).toBeTruthy();
		expect(screen.getByText("来自《故事》")).toBeTruthy();
		expect(screen.getByText("第 01 组")).toBeTruthy();
		expect(screen.getByText("第 1 张")).toBeTruthy();
		expect(screen.getByText("已选")).toBeTruthy();
		const nodeImagePreview = document.querySelector(
			'img[src="/api/v1/media-assets/node-image-1/content"]',
		);
		expect(nodeImagePreview?.className).toContain("object-contain");
		expect(nodeImagePreview?.parentElement?.parentElement?.className).toContain(
			"bg-muted-foreground/10",
		);

		fireEvent.click(screen.getAllByRole("button", { name: /第 01 组/ })[1]);

		expect(onToggleShortcutReference).toHaveBeenCalledWith(nodeImage);
	});
});

describe("MaterialLibraryImportDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("uploads image assets and selects them for confirmation", async () => {
		const uploadedAsset = mediaAsset({
			id: "uploaded-image",
			filename: "uploaded.png",
			url: "/api/v1/media-assets/uploaded-image/content",
		});
		const onConfirmSelection = vi.fn();
		const onUploadAsset = vi.fn().mockResolvedValue(uploadedAsset);
		render(
			<MaterialLibraryImportDialog
				mediaAssets={[]}
				open
				onConfirmSelection={onConfirmSelection}
				onOpenChange={vi.fn()}
				onUploadAsset={onUploadAsset}
			/>,
		);

		const file = new File(["image"], "uploaded.png", { type: "image/png" });
		fireEvent.change(screen.getByLabelText("上传图片素材"), {
			target: { files: [file] },
		});

		await waitFor(() => {
			expect(onUploadAsset).toHaveBeenCalledWith(file);
		});
		expect(await screen.findByText("uploaded.png")).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: /uploaded.png/ }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "加入生成记录" }));

		expect(onConfirmSelection).toHaveBeenCalledWith([uploadedAsset]);
	});

	it("shows an upload error for non-image files", async () => {
		const onUploadAsset = vi.fn();
		render(
			<MaterialLibraryImportDialog
				mediaAssets={[]}
				open
				onConfirmSelection={vi.fn()}
				onOpenChange={vi.fn()}
				onUploadAsset={onUploadAsset}
			/>,
		);

		const file = new File(["notes"], "notes.txt", { type: "text/plain" });
		fireEvent.change(screen.getByLabelText("上传图片素材"), {
			target: { files: [file] },
		});

		expect(await screen.findByText("请选择图片文件。")).toBeTruthy();
		expect(onUploadAsset).not.toHaveBeenCalled();
	});

	it("resets transient search state when reopened", () => {
		const asset = mediaAsset();
		const { rerender } = render(
			<MaterialLibraryImportDialog
				mediaAssets={[asset]}
				open
				selectedAssetIds={[asset.id]}
				onConfirmSelection={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("搜索图片素材"), {
			target: { value: "missing" },
		});
		expect(screen.queryByText("still.png")).toBeNull();

		rerender(
			<MaterialLibraryImportDialog
				mediaAssets={[asset]}
				open={false}
				selectedAssetIds={[asset.id]}
				onConfirmSelection={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);
		rerender(
			<MaterialLibraryImportDialog
				mediaAssets={[asset]}
				open
				selectedAssetIds={[asset.id]}
				onConfirmSelection={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("still.png")).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: /still.png/ }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});

	it("prevents closing while confirming selected materials", () => {
		render(
			<MaterialLibraryImportDialog
				confirming
				mediaAssets={[mediaAsset()]}
				open
				onConfirmSelection={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
	});
});

describe("PrimaryParamControl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
	});

	afterEach(() => {
		cleanup();
	});

	it("opens, selects an option, and closes", async () => {
		const onChange = vi.fn();
		render(<PrimaryParamControl param={durationParam} value="4" onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: "时长：4 秒" }));
		await screen.findByRole("dialog", { name: "时长" });
		fireEvent.click(screen.getByRole("button", { name: "5 秒" }));

		expect(onChange).toHaveBeenCalledWith("5");
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "时长" })).toBeNull());
	});

	it("renders voice options as a compact voice picker with preview", async () => {
		const onChange = vi.fn();
		const onPreviewVoice = vi.fn();
		render(
			<PrimaryParamControl
				param={voiceParam}
				value="Chinese (Mandarin)_Warm_Bestie"
				onChange={onChange}
				onPreviewVoice={onPreviewVoice}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "音色：中文 (普通话) · 温暖闺蜜" }));
		await screen.findByRole("dialog", { name: "音色" });

		expect(screen.getByRole("button", { name: "全部音色" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "我的音色" })).toBeNull();
		expect(screen.getByRole("combobox", { name: "语言" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "预览 英文 · Aussie Bloke" }));
		expect(onPreviewVoice).toHaveBeenCalledWith("English_Aussie_Bloke");

		fireEvent.click(screen.getByRole("button", { name: "选择 英文 · Aussie Bloke" }));

		expect(onChange).toHaveBeenCalledWith("English_Aussie_Bloke");
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "音色" })).toBeNull());
	});
});

describe("SecondaryParamsDropdown", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
	});

	afterEach(() => {
		cleanup();
	});

	it("opens a dropdown form and updates secondary params", async () => {
		const onChange = vi.fn();
		render(
			<SecondaryParamsDropdown
				params={[compressionParam]}
				values={{ outputCompression: 100 }}
				onChange={onChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "其他" }));
		await screen.findByRole("dialog", { name: "其他参数" });
		fireEvent.change(screen.getByDisplayValue("100"), { target: { value: "80" } });

		expect(onChange).toHaveBeenCalledWith("outputCompression", 80);
	});
});
