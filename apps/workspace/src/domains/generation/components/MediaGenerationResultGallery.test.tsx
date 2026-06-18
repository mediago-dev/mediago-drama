import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { GenerationResultGallery } from "./MediaGenerationResultGallery";
import { generatedAssetSaveKey } from "./generatedResultActions";

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ src }: { src: string }) => <div data-testid="video-player" data-src={src} />,
}));

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
	prompt: "生成三张角色图",
	assets: [
		{ kind: "image", url: "https://example.test/role-a.png", mimeType: "image/png" },
		{ kind: "image", url: "https://example.test/role-b.png", mimeType: "image/png" },
		{ kind: "image", url: "https://example.test/role-c.png", mimeType: "image/png" },
	],
});

describe("GenerationResultGallery", () => {
	afterEach(() => {
		cleanup();
	});

	it("allows generated video assets to be selected", () => {
		const entry = videoEntry();
		const onToggleAsset = vi.fn();

		render(
			<GenerationResultGallery
				emptyText="暂无视频"
				entries={[entry]}
				kind="video"
				selectedAssetKeys={[]}
				onToggleAsset={onToggleAsset}
			/>,
		);

		expect(screen.getByTestId("video-player").getAttribute("data-src")).toBe(
			"https://example.test/scene.mp4",
		);

		const selectButton = screen.getByRole("checkbox", { name: "选入视频" });

		expect(selectButton.className).toContain("left-2");
		fireEvent.click(selectButton);

		expect(onToggleAsset).toHaveBeenCalledWith(entry.assets?.[0], true);
	});

	it("allows generated assets to be saved", () => {
		const entry = videoEntry();
		const onSaveAsset = vi.fn();

		render(
			<GenerationResultGallery
				emptyText="暂无视频"
				entries={[entry]}
				kind="video"
				selectedAssetKeys={[]}
				onSaveAsset={onSaveAsset}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "保存素材" }));

		expect(onSaveAsset).toHaveBeenCalledWith(entry, entry.assets?.[0]);
	});

	it("shows saved state for generated asset save actions", () => {
		const entry = videoEntry();
		const asset = entry.assets?.[0];
		if (!asset) throw new Error("missing test asset");

		render(
			<GenerationResultGallery
				emptyText="暂无视频"
				entries={[entry]}
				kind="video"
				savedAssetKeys={[generatedAssetSaveKey(entry, asset)]}
				selectedAssetKeys={[]}
				onSaveAsset={vi.fn()}
			/>,
		);

		expect((screen.getByRole("button", { name: "素材已保存" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("previews images in rendered order and toggles the current preview image", () => {
		const entry = imageEntry();
		const onToggleAsset = vi.fn();

		render(
			<GenerationResultGallery
				emptyText="暂无图片"
				entries={[entry]}
				kind="image"
				selectedAssetKeys={["image:https://example.test/role-b.png"]}
				onToggleAsset={onToggleAsset}
			/>,
		);

		const previewButtons = screen.getAllByRole("button", { name: "预览生成图片" });
		const secondPreviewButton = previewButtons[1];
		if (!secondPreviewButton) throw new Error("missing second preview button");
		expect(secondPreviewButton.className).toContain("bg-muted-foreground/10");
		fireEvent.click(secondPreviewButton);

		expect(screen.getByRole("dialog", { name: "图片预览" }).getAttribute("data-index")).toBe("1");
		expect(screen.getByTestId("preview-sources").textContent).toBe(
			"https://example.test/role-a.png|https://example.test/role-b.png|https://example.test/role-c.png",
		);

		const dialog = screen.getByRole("dialog", { name: "图片预览" });
		const checkbox = within(dialog).getByRole("checkbox", { name: "取消选入图片" });
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(checkbox);

		expect(onToggleAsset).toHaveBeenCalledWith(entry.assets?.[1], false);
	});
});
