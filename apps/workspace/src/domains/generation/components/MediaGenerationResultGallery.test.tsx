import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { GenerationResultGallery } from "./MediaGenerationResultGallery";
import { generatedAssetSaveKey } from "./generatedResultActions";

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ src }: { src: string }) => <div data-testid="video-player" data-src={src} />,
}));

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

describe("GenerationResultGallery", () => {
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
});
