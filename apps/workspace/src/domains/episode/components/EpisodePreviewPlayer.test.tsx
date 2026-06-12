import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodePreviewPlayer } from "./EpisodePreviewPlayer";

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ load, src }: { load?: string; src: string }) => (
		<div data-testid="video-player" data-load={load ?? ""} data-src={src} />
	),
}));

describe("EpisodePreviewPlayer", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows a generation prompt when the selected clip has no video", () => {
		render(<EpisodePreviewPlayer title="第 01 组 总时长：00:13.50" />);

		expect(screen.getByTestId("episode-preview-empty-state")).toBeTruthy();
		expect(screen.getByText("该分镜还没有生成视频")).toBeTruthy();
		expect(screen.getByText("点击下方卡片右上角的「生成」开始制作")).toBeTruthy();
	});

	it("loads the preview media when it is visible", () => {
		render(<EpisodePreviewPlayer title="第一章" videoUrl="https://example.test/preview.mp4" />);

		const player = screen.getByTestId("video-player");
		expect(player.getAttribute("data-src")).toBe("https://example.test/preview.mp4");
		expect(player.getAttribute("data-load")).toBe("visible");
	});

	it("shows the first clip poster before preview playback starts", () => {
		const { container } = render(
			<EpisodePreviewPlayer
				title="第一章"
				videoUrl="https://example.test/preview.mp4"
				posterUrl="/api/v1/media-assets/asset-1/poster"
				currentTime={0}
				isPlaying={false}
			/>,
		);

		const poster = screen.getByTestId("episode-preview-poster");
		expect(poster).toBeTruthy();
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"/api/v1/media-assets/asset-1/poster",
		);
	});

	it("hides the poster overlay during preview playback", () => {
		render(
			<EpisodePreviewPlayer
				title="第一章"
				videoUrl="https://example.test/preview.mp4"
				posterUrl="/api/v1/media-assets/asset-1/poster"
				currentTime={0}
				isPlaying
			/>,
		);

		expect(screen.queryByTestId("episode-preview-poster")).toBeNull();
	});
});
