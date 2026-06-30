import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodePreviewPlayer } from "./EpisodePreviewPlayer";

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ load, poster, src }: { load?: string; poster?: string; src: string }) => (
		<div data-testid="video-player" data-load={load ?? ""} data-poster={poster} data-src={src} />
	),
}));

describe("EpisodePreviewPlayer", () => {
	afterEach(() => {
		cleanup();
		delete window.mediagoDesktop;
		vi.unstubAllEnvs();
	});

	it("shows a generation prompt when the selected clip has no video", () => {
		render(<EpisodePreviewPlayer title="第 01 组 总时长：00:13.50" />);

		expect(screen.getByTestId("episode-preview-empty-state")).toBeTruthy();
		expect(screen.getByText("该分镜还没有生成视频")).toBeTruthy();
		expect(screen.getByText("点击下方卡片右上角的「生成」开始制作")).toBeTruthy();
	});

	it("loads the preview media only when the player becomes visible", () => {
		render(<EpisodePreviewPlayer title="第一章" videoUrl="https://example.test/preview.mp4" />);

		const player = screen.getByTestId("video-player");
		expect(player.getAttribute("data-src")).toBe("https://example.test/preview.mp4");
		expect(player.getAttribute("data-load")).toBe("visible");
	});

	it("renders preview media URLs against the packaged desktop server", () => {
		vi.stubEnv("DEV", false);
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;

		render(
			<EpisodePreviewPlayer
				title="第一章"
				videoUrl="/api/v1/media-assets/asset-1/content"
				posterUrl="/api/v1/media-assets/asset-1/poster"
				currentTime={0}
				isPlaying={false}
			/>,
		);

		const player = screen.getByTestId("video-player");
		expect(player).toHaveAttribute(
			"data-src",
			"http://127.0.0.1:48273/api/v1/media-assets/asset-1/content",
		);
		expect(player).toHaveAttribute(
			"data-poster",
			"http://127.0.0.1:48273/api/v1/media-assets/asset-1/poster",
		);
		expect(screen.getByTestId("episode-preview-poster").querySelector("img")).toHaveAttribute(
			"src",
			"http://127.0.0.1:48273/api/v1/media-assets/asset-1/poster",
		);
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
