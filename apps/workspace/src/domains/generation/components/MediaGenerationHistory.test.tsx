import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { HistoryGenerationList } from "./MediaGenerationHistory";

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

	it("renders full-page history rows with horizontal generated assets and in-place selection", () => {
		const entry = imageEntry();
		const onSelectEntry = vi.fn();
		const onToggleAsset = vi.fn();
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
				onSelectEntry={onSelectEntry}
				onToggleAsset={onToggleAsset}
				onUsePrompt={onUsePrompt}
			/>,
		);

		expect(screen.queryByText("3 张")).toBeNull();
		expect(container.querySelectorAll("img")).toHaveLength(3);
		expect(screen.queryByText("已选")).toBeNull();
		expect(
			screen.getByRole("checkbox", { name: "取消选入结果" }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(screen.getAllByRole("checkbox", { name: "选入结果" })[0]);

		expect(onToggleAsset).toHaveBeenCalledWith(entry.assets?.[1], true);
		expect(onSelectEntry).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "用此提示词编辑" }));

		expect(onUsePrompt).toHaveBeenCalledWith(entry);
	});

	it("renders one pending placeholder per requested image in full-page history rows", () => {
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
		expect(screen.queryByText("暂无图片")).toBeNull();
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
