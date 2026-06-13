import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationParam } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
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

describe("ReferenceSelectionDialog", () => {
	afterEach(() => {
		cleanup();
	});

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
