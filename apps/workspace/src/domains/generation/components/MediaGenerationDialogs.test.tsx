import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { ReferenceSelectionDialog } from "./MediaGenerationDialogs";

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

describe("ReferenceSelectionDialog", () => {
	it("filters reference materials by all, video, and image tabs", () => {
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
				]}
				open
				references={[]}
				requiresReference={false}
				selectableKinds={new Set(["image", "video"])}
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

		const videoTab = screen.getByRole("tab", { name: /视频/ });
		fireEvent.mouseDown(videoTab, { button: 0 });
		fireEvent.click(videoTab);

		expect(screen.queryByText("still.png")).toBeNull();
		expect(screen.getByText("scene.mp4")).toBeTruthy();

		const imageTab = screen.getByRole("tab", { name: /图片/ });
		fireEvent.mouseDown(imageTab, { button: 0 });
		fireEvent.click(imageTab);

		expect(screen.getByText("still.png")).toBeTruthy();
		expect(screen.queryByText("scene.mp4")).toBeNull();
	});
});
