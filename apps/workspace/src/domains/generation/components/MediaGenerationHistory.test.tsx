import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { HistoryGenerationList } from "./MediaGenerationHistory";

vi.mock("react-photo-view", () => ({
	PhotoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	PhotoView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const videoEntry = (): GenerationEntry => ({
	id: "entry-video",
	kind: "video",
	status: "completed",
	content: "",
	prompt: "生成一个街景镜头",
	assets: [{ kind: "video", url: "https://example.test/scene.mp4", mimeType: "video/mp4" }],
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

	it("renders full-page image history as a flat image grid with hover actions", () => {
		const entry = imageEntry();
		const onDeleteAsset = vi.fn();
		const onSaveAsset = vi.fn();
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
				onSaveAsset={onSaveAsset}
				onSelectEntry={vi.fn()}
				onToggleAsset={onToggleAsset}
				onUseAssetAsReference={onUseAssetAsReference}
				onUsePrompt={onUsePrompt}
			/>,
		);

		expect(container.querySelectorAll("img")).toHaveLength(3);
		expect(screen.queryByText("生成三张角色设定图")).toBeNull();
		expect(screen.queryByText("已完成")).toBeNull();
		expect(screen.getAllByRole("button", { name: "预览图片" })).toHaveLength(3);
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

		fireEvent.click(screen.getAllByRole("button", { name: "下载图片" })[0]);

		expect(onSaveAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);

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
		expect(within(menu).getByRole("menuitem", { name: "下载" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "派生" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "使用此提示词" })).toBeTruthy();
		expect(within(menu).getByRole("menuitem", { name: "删除" })).toBeTruthy();

		fireEvent.click(within(menu).getByRole("menuitem", { name: "派生" }));

		expect(onUseAssetAsReference).toHaveBeenCalledWith(entry.assets?.[0]);

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
