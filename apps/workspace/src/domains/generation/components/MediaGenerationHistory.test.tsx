import {
	cleanup,
	fireEvent,
	render as testingRender,
	screen,
	within,
} from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { HistoryGenerationList } from "./MediaGenerationHistory";

vi.mock("react-photo-view", () => ({
	PhotoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	PhotoSlider: ({
		images,
		index,
		onIndexChange,
		toolbarRender,
		visible,
	}: {
		images: Array<{ key: string; src: string }>;
		index: number;
		onIndexChange: (index: number) => void;
		toolbarRender?: (props: { images: unknown[]; index: number }) => React.ReactNode;
		visible: boolean;
	}) =>
		visible ? (
			<div role="dialog" aria-label="图片预览" data-index={index}>
				<div data-testid="preview-sources">{images.map((image) => image.src).join("|")}</div>
				{toolbarRender?.({ images, index })}
				<button type="button" onClick={() => onIndexChange(index + 1)}>
					下一张
				</button>
			</div>
		) : null,
	PhotoView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ mimeType, src }: { mimeType?: string; src: string }) => (
		<video data-testid="video-preview" data-mime-type={mimeType} src={src} />
	),
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

const videoEntry = (): GenerationEntry => ({
	id: "entry-video",
	kind: "video",
	status: "completed",
	content: "",
	prompt: "生成一个街景镜头",
	assets: [{ kind: "video", url: "https://example.test/scene.mp4", mimeType: "video/mp4" }],
});

const audioEntry = (): GenerationEntry => ({
	id: "entry-audio",
	kind: "audio",
	status: "completed",
	content: "",
	prompt: "把这段旁白生成配音",
	assets: [{ kind: "audio", url: "https://example.test/narration.mp3", mimeType: "audio/mpeg" }],
});

const imageEntry = (): GenerationEntry => ({
	id: "entry-image",
	kind: "image",
	status: "completed",
	content: "",
	prompt: "生成三张角色设定图",
	assets: [
		{ kind: "image", url: "https://example.test/role-a.png", mimeType: "image/png" },
		{ kind: "image", url: "https://example.test/role-b.png", mimeType: "image/png" },
		{ kind: "image", url: "https://example.test/role-c.png", mimeType: "image/png" },
	],
});

const pendingImageEntry = (): GenerationEntry => ({
	id: "entry-pending-image",
	kind: "image",
	status: "running",
	content: "",
	prompt: "生成四张角色图",
	requestDetails: [{ label: "图像数量", value: "4" }],
	assets: [],
});

const partialPendingImageEntry = (): GenerationEntry => ({
	id: "entry-partial-pending-image",
	kind: "image",
	status: "running",
	content: "",
	prompt: "生成四张角色图",
	requestDetails: [{ label: "图像数量", value: "4" }],
	assets: [
		{ kind: "image", url: "https://example.test/partial-a.png", mimeType: "image/png" },
		{ kind: "image", url: "https://example.test/partial-b.png", mimeType: "image/png" },
	],
});

const failedImageEntry = (): GenerationEntry => ({
	id: "entry-failed-image",
	kind: "image",
	status: "failed",
	content: "",
	error: "生成失败",
	prompt: "生成三张失败图",
	requestDetails: [{ label: "图像数量", value: "3" }],
	assets: [],
});

describe("HistoryGenerationList", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders generated video history items with a video thumbnail", () => {
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-video"
				deletingEntryIds={[]}
				entries={[videoEntry()]}
				kind="video"
				selectedAssetKeys={[]}
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		const video = container.querySelector("video");

		expect(video).not.toBeNull();
		expect(video?.getAttribute("src")).toBe("https://example.test/scene.mp4");
		expect(video?.getAttribute("preload")).toBe("auto");
		expect(video?.playsInline).toBe(true);
	});

	it("renders full-page video history as a flat media grid", async () => {
		const entry = videoEntry();
		const onDeleteAsset = vi.fn();
		const onSaveAsset = vi.fn();
		const onToggleAsset = vi.fn();
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-video"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="video"
				selectedAssetKeys={["video:https://example.test/scene.mp4"]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onDeleteAsset={onDeleteAsset}
				onSaveAsset={onSaveAsset}
				onSelectEntry={vi.fn()}
				onToggleAsset={onToggleAsset}
			/>,
		);

		expect(container.querySelectorAll("video")).toHaveLength(1);
		expect(screen.queryByText("生成一个街景镜头")).toBeNull();
		expect(screen.queryByText("已完成")).toBeNull();
		expect(screen.getByRole("button", { name: "预览视频" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "下载视频" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "派生视频" })).toBeNull();
		expect(screen.getByRole("button", { name: "删除视频" })).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: "取消选入结果" }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "预览视频" }));

		const previewDialog = screen.getByRole("dialog", { name: "预览视频" });
		const previewVideo = within(previewDialog).getByTestId("video-preview");
		expect(previewVideo.getAttribute("src")).toBe("https://example.test/scene.mp4");
		expect(previewVideo.getAttribute("data-mime-type")).toBe("video/mp4");
		fireEvent.click(within(previewDialog).getByRole("button", { name: "关闭预览" }));

		const card = container.querySelector("article");
		if (!card) throw new Error("missing history video card");
		fireEvent.contextMenu(card, { clientX: 48, clientY: 48 });

		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "预览" })).toBeTruthy();
		expect(within(menu).queryByRole("menuitem", { name: "派生" })).toBeNull();
		fireEvent.keyDown(menu, { key: "Escape" });

		fireEvent.click(screen.getByRole("button", { name: "下载视频" }));

		expect(onSaveAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);

		fireEvent.click(screen.getByRole("button", { name: "删除视频" }));
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这个视频？" })).getByRole("button", {
				name: "删除",
			}),
		);

		expect(onDeleteAsset).toHaveBeenCalledWith(entry, entry.assets?.[0], 0);
	});

	it("renders full-page audio history with the same media grid style", () => {
		const entry = audioEntry();
		const onDeleteAsset = vi.fn();
		const onSaveAsset = vi.fn();
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-audio"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="audio"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onDeleteAsset={onDeleteAsset}
				onSaveAsset={onSaveAsset}
				onSelectEntry={vi.fn()}
			/>,
		);

		const card = container.querySelector("article");
		const audioPlayer = screen.getByTestId("audio-player");

		expect(card?.className).toContain("aspect-[4/3]");
		expect(audioPlayer.getAttribute("data-src")).toBe("https://example.test/narration.mp3");
		expect(audioPlayer.getAttribute("data-mime-type")).toBe("audio/mpeg");
		expect(screen.queryByText("把这段旁白生成配音")).toBeNull();
		expect(screen.queryByText("已完成")).toBeNull();
		expect(screen.getByRole("button", { name: "下载音频" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "删除音频" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "派生音频" })).toBeNull();
		expect(screen.queryByRole("button", { name: "预览音频" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "下载音频" }));

		expect(onSaveAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);

		fireEvent.click(screen.getByRole("button", { name: "删除音频" }));
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这个音频？" })).getByRole("button", {
				name: "删除",
			}),
		);

		expect(onDeleteAsset).toHaveBeenCalledWith(entry, entry.assets?.[0], 0);
	});

	it("renders full-page image history as a flat image grid with hover actions", () => {
		const entry = imageEntry();
		const onDeleteAsset = vi.fn();
		const onSaveAsset = vi.fn();
		const onEditAsset = vi.fn();
		const onToggleAsset = vi.fn();
		const onUseAssetAsReference = vi.fn();
		const onUsePrompt = vi.fn();
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={["image:https://example.test/role-a.png"]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onDeleteAsset={onDeleteAsset}
				onEditAsset={onEditAsset}
				onSaveAsset={onSaveAsset}
				onSelectEntry={vi.fn()}
				onToggleAsset={onToggleAsset}
				onUseAssetAsReference={onUseAssetAsReference}
				onUsePrompt={onUsePrompt}
			/>,
		);

		const images = container.querySelectorAll("img");
		expect(images).toHaveLength(3);
		images.forEach((image) => expect(image.className).toContain("object-contain"));
		images.forEach((image) =>
			expect(image.parentElement?.className).toContain("bg-muted-foreground/10"),
		);
		expect(screen.queryByText("生成三张角色设定图")).toBeNull();
		expect(screen.queryByText("已完成")).toBeNull();
		expect(screen.getAllByRole("button", { name: "预览图片" })).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: "编辑图片" })).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: "下载图片" })).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: "派生图片" })).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: "使用此提示词" })).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: "删除图片" })).toHaveLength(3);
		expect(
			screen.getByRole("checkbox", { name: "取消选入结果" }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(screen.getAllByRole("checkbox", { name: "选入结果" })[0]);

		expect(onToggleAsset).toHaveBeenCalledWith(entry.assets?.[1], true);
		onToggleAsset.mockClear();

		fireEvent.click(screen.getAllByRole("button", { name: "预览图片" })[1]);

		expect(screen.getByRole("dialog", { name: "图片预览" }).getAttribute("data-index")).toBe("1");
		expect(screen.getByTestId("preview-sources").textContent).toBe(
			"https://example.test/role-a.png|https://example.test/role-b.png|https://example.test/role-c.png",
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "选入图片" }));

		expect(onToggleAsset).toHaveBeenCalledWith(entry.assets?.[1], true);
		onToggleAsset.mockClear();

		fireEvent.click(screen.getAllByRole("button", { name: "下载图片" })[0]);

		expect(onSaveAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);

		fireEvent.click(screen.getAllByRole("button", { name: "编辑图片" })[2]);

		expect(onEditAsset).toHaveBeenCalledWith(entry, entry.assets?.[2]);

		fireEvent.click(screen.getAllByRole("button", { name: "派生图片" })[1]);

		expect(onUseAssetAsReference).toHaveBeenCalledWith(entry.assets?.[1]);
		expect(onToggleAsset).not.toHaveBeenCalled();

		fireEvent.click(screen.getAllByRole("button", { name: "使用此提示词" })[0]);

		expect(onUsePrompt).toHaveBeenCalledWith(entry);

		fireEvent.click(screen.getAllByRole("button", { name: "删除图片" })[2]);

		expect(onDeleteAsset).not.toHaveBeenCalled();

		const dialog = screen.getByRole("alertdialog", { name: "删除这张图片？" });
		expect(
			within(dialog).getByText("删除后会从这条生成记录中移除，无法在历史记录中恢复。"),
		).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		expect(onDeleteAsset).toHaveBeenCalledWith(entry, entry.assets?.[2], 2);
	});

	it("shows a tooltip for image history action buttons", async () => {
		render(
			<HistoryGenerationList
				activeEntryId="entry-image"
				deletingEntryIds={[]}
				entries={[imageEntry()]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSaveAsset={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		fireEvent.focus(screen.getAllByRole("button", { name: "下载图片" })[0]);

		expect((await screen.findAllByText("下载")).length).toBeGreaterThan(0);
	});

	it("shows the image history actions in the right-click menu", async () => {
		const entry = imageEntry();
		const onDeleteAsset = vi.fn();
		const onEditAsset = vi.fn();
		const onUseAssetAsReference = vi.fn();
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onDeleteAsset={onDeleteAsset}
				onEditAsset={onEditAsset}
				onSaveAsset={vi.fn()}
				onSelectEntry={vi.fn()}
				onUseAssetAsReference={onUseAssetAsReference}
				onUsePrompt={vi.fn()}
			/>,
		);

		const card = container.querySelector("article");
		if (!card) throw new Error("missing history image card");

		fireEvent.contextMenu(card, { clientX: 48, clientY: 48 });

		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "预览" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "编辑" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "下载" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "派生" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "使用此提示词" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "删除" })).toBeTruthy();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "派生" }));

		expect(onUseAssetAsReference).toHaveBeenCalledWith(entry.assets?.[0]);

		fireEvent.contextMenu(card, { clientX: 48, clientY: 48 });
		const editMenu = await screen.findByRole("menu");
		fireEvent.click(within(editMenu).getByRole("menuitem", { name: "编辑" }));

		expect(onEditAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);

		fireEvent.contextMenu(card, { clientX: 48, clientY: 48 });
		const deleteMenu = await screen.findByRole("menu");
		fireEvent.click(within(deleteMenu).getByRole("menuitem", { name: "删除" }));

		expect(onDeleteAsset).not.toHaveBeenCalled();

		const dialog = screen.getByRole("alertdialog", { name: "删除这张图片？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		expect(onDeleteAsset).toHaveBeenCalledWith(entry, entry.assets?.[0], 0);
	});

	it("deletes generated images by persisted slot index instead of visible array index", () => {
		const entry: GenerationEntry = {
			...imageEntry(),
			assets: [
				{
					kind: "image",
					url: "https://example.test/role-b.png",
					mimeType: "image/png",
					slotIndex: 1,
				},
				{
					kind: "image",
					url: "https://example.test/role-d.png",
					mimeType: "image/png",
					slotIndex: 3,
				},
			],
		};
		const onDeleteAsset = vi.fn();
		render(
			<HistoryGenerationList
				activeEntryId="entry-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onDeleteAsset={onDeleteAsset}
				onSelectEntry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: "删除图片" })[1]);
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这张图片？" })).getByRole("button", {
				name: "删除",
			}),
		);

		expect(onDeleteAsset).toHaveBeenCalledWith(entry, entry.assets?.[1], 3);
	});

	it("renders pending image placeholders in full-page image history", () => {
		render(
			<HistoryGenerationList
				activeEntryId="entry-pending-image"
				deletingEntryIds={[]}
				entries={[pendingImageEntry()]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(screen.getAllByRole("img", { name: /生成中/ })).toHaveLength(4);
		expect(screen.queryByText("暂无生成图片。")).toBeNull();
		expect(screen.queryByRole("button", { name: "预览图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "下载图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "派生图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "使用此提示词" })).toBeNull();
		expect(screen.queryByRole("button", { name: "删除图片" })).toBeNull();
	});

	it("does not treat an image ratio detail as the pending image count", () => {
		const entry: GenerationEntry = {
			...pendingImageEntry(),
			requestDetails: [{ label: "数量", value: "3:4" }],
		};

		render(
			<HistoryGenerationList
				activeEntryId={entry.id}
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(screen.getAllByRole("img", { name: /生成中/ })).toHaveLength(1);
	});

	it("shows right-click actions for pending image placeholders", async () => {
		const entry = pendingImageEntry();
		const onDeleteEntry = vi.fn();
		const onDeletePlaceholder = vi.fn();
		const onUsePrompt = vi.fn();
		render(
			<HistoryGenerationList
				activeEntryId="entry-pending-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={onDeleteEntry}
				onDeletePlaceholder={onDeletePlaceholder}
				onSelectEntry={vi.fn()}
				onUsePrompt={onUsePrompt}
			/>,
		);

		fireEvent.contextMenu(screen.getAllByRole("img", { name: /生成中/ })[0]);

		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "预览" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(within(menu).getByRole("menuitem", { name: "下载" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(within(menu).getByRole("menuitem", { name: "派生" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(within(menu).getByRole("menuitem", { name: "使用此提示词" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "删除" })).toBeTruthy();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "使用此提示词" }));

		expect(onUsePrompt).toHaveBeenCalledWith(entry);

		fireEvent.contextMenu(screen.getAllByRole("img", { name: /生成中/ })[0]);
		const deleteMenu = await screen.findByRole("menu");
		fireEvent.click(within(deleteMenu).getByRole("menuitem", { name: "删除" }));

		expect(onDeleteEntry).not.toHaveBeenCalled();

		const dialog = screen.getByRole("alertdialog", { name: "删除这张图片？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		expect(onDeletePlaceholder).toHaveBeenCalledWith(entry, 0);
		expect(onDeleteEntry).not.toHaveBeenCalled();
	});

	it("mixes completed assets with pending placeholders while a multi-image task is still running", () => {
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-partial-pending-image"
				deletingEntryIds={[]}
				entries={[partialPendingImageEntry()]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(container.querySelectorAll("img")).toHaveLength(2);
		expect(screen.getAllByRole("img", { name: /生成中/ })).toHaveLength(2);
	});

	it("does not turn deleted pending-task image slots back into loading placeholders", () => {
		render(
			<HistoryGenerationList
				activeEntryId="entry-pending-image"
				deletedAssetPlaceholderCounts={{ "entry-pending-image": 4 }}
				deletingEntryIds={[]}
				entries={[pendingImageEntry()]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("img", { name: /生成中/ })).toBeNull();
		expect(screen.getByText("暂无生成图片。")).toBeTruthy();
	});

	it("uses persisted deleted image slots after history refresh", () => {
		render(
			<HistoryGenerationList
				activeEntryId="entry-partial-pending-image"
				deletingEntryIds={[]}
				entries={[
					{
						...partialPendingImageEntry(),
						deletedAssetSlots: [2],
					},
				]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(screen.getAllByRole("img", { name: /生成中/ })).toHaveLength(1);
		expect(screen.getByRole("img", { name: "第 4 张生成中" })).toBeTruthy();
		expect(screen.queryByRole("img", { name: "第 3 张生成中" })).toBeNull();
	});

	it("renders failed image placeholders without hover actions", () => {
		const entry = failedImageEntry();
		const onDeleteEntry = vi.fn();
		const onUsePrompt = vi.fn();
		render(
			<HistoryGenerationList
				activeEntryId="entry-failed-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={onDeleteEntry}
				onSelectEntry={vi.fn()}
				onUsePrompt={onUsePrompt}
			/>,
		);

		expect(screen.getAllByRole("img", { name: /生成失败/ })).toHaveLength(3);
		expect(screen.queryByText("生成三张失败图")).toBeNull();
		expect(screen.queryByRole("button", { name: "预览图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "下载图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "派生图片" })).toBeNull();
		expect(screen.queryByRole("button", { name: "使用此提示词" })).toBeNull();
		expect(screen.queryByRole("button", { name: "删除图片" })).toBeNull();
		expect(onUsePrompt).not.toHaveBeenCalled();
		expect(onDeleteEntry).not.toHaveBeenCalled();
	});

	it("shows right-click actions for failed image placeholders", async () => {
		const entry = failedImageEntry();
		const onDeleteEntry = vi.fn();
		const onDeletePlaceholder = vi.fn();
		render(
			<HistoryGenerationList
				activeEntryId="entry-failed-image"
				deletingEntryIds={[]}
				entries={[entry]}
				kind="image"
				selectedAssetKeys={[]}
				variant="list"
				onDeleteEntry={onDeleteEntry}
				onDeletePlaceholder={onDeletePlaceholder}
				onSelectEntry={vi.fn()}
				onUsePrompt={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(screen.getAllByRole("img", { name: /生成失败/ })[0]);

		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "预览" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "下载" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "派生" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "使用此提示词" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "删除" })).toBeTruthy();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "删除" }));
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "删除这张图片？" })).getByRole("button", {
				name: "删除",
			}),
		);

		expect(onDeletePlaceholder).toHaveBeenCalledWith(entry, 0);
		expect(onDeleteEntry).not.toHaveBeenCalled();
	});

	it("uses the requested image count while compact pending history has no assets yet", () => {
		render(
			<HistoryGenerationList
				activeEntryId="entry-pending-image"
				deletingEntryIds={[]}
				entries={[pendingImageEntry()]}
				kind="image"
				selectedAssetKeys={[]}
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		expect(screen.getByText("4 张")).toBeTruthy();
	});
});
