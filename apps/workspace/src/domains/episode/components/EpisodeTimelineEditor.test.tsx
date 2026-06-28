import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import { EpisodeTimelineEditor } from "./EpisodeTimelineEditor";

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe("EpisodeTimelineEditor", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "ResizeObserver", {
			value: ResizeObserverMock,
			configurable: true,
		});
	});

	afterEach(() => {
		cleanup();
		delete window.mediagoDesktop;
		vi.unstubAllEnvs();
	});

	it("renders the expanded clip strip with only visible video clips", () => {
		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("episode-clip-strip")).toBeTruthy();
		expect(screen.getByText("00:00")).toBeTruthy();
		expect(screen.getByText("01:36")).toBeTruthy();
		expect(screen.getByTestId("clip-strip-card-clip-cold-open")).toBeTruthy();
		expect(screen.getByTestId("clip-strip-card-clip-problem")).toBeTruthy();
		expect(screen.queryByTestId("clip-strip-card-clip-vo-hook")).toBeNull();
		expect(screen.queryByTestId("clip-strip-card-clip-caption-one")).toBeNull();
		expect(screen.queryByTestId("clip-strip-card-clip-bgm")).toBeNull();
		expect(screen.queryByTestId("clip-strip-card-clip-logo")).toBeNull();
		expect(screen.getByTestId("episode-timeline-editor").getAttribute("style")).toContain(
			"height: 184px",
		);
		const generateButton = within(screen.getByTestId("clip-strip-card-clip-cold-open")).getByRole(
			"button",
			{
				name: "生成 冷开场",
			},
		);
		expect(generateButton).toBeTruthy();
		expect(generateButton.className).toContain("rounded-md");
		expect(generateButton.className).toContain("cursor-pointer");
		expect(generateButton.className).toContain("bg-card");
		expect(generateButton.className).toContain("dark:bg-background");
		expect(generateButton.className).toContain("text-foreground");
		expect(generateButton.className).not.toContain("rounded-full");
		expect(
			within(screen.getByTestId("clip-strip-card-clip-cold-open")).queryByText("冷开场"),
		).toBeNull();
		expect(screen.getByTestId("clip-strip-card-clip-cold-open").className).not.toContain(
			"border-2",
		);
		expect(screen.getByTestId("clip-strip-card-clip-cold-open").className).not.toContain(
			"focus-within:border-primary",
		);
		expect(screen.getByTestId("clip-strip-card-clip-cold-open").className).toContain(
			"focus-within:border-border",
		);
		const selectionTag = screen.getByTestId("clip-strip-card-selection-clip-cold-open");
		expect(selectionTag.textContent).toBe("选中");
		expect(selectionTag.className).toContain("bottom-2");
		expect(selectionTag.className).toContain("left-2");
		expect(selectionTag.className).toContain("bg-primary");
		expect(screen.queryByTestId("clip-strip-card-selection-clip-problem")).toBeNull();
		expect(screen.getByTestId("clip-strip-card-clip-cold-open").className).not.toContain(
			"translate-y",
		);
		expect(screen.getByTestId("clip-strip-card-status-rail-clip-cold-open").className).toContain(
			"bg-warning-foreground",
		);
		expect(
			within(screen.getByTestId("clip-strip-card-clip-cold-open")).queryByText("待生成"),
		).toBeNull();
		expect(
			within(screen.getByTestId("clip-strip-card-clip-agent-pass")).queryByText("生成中"),
		).toBeNull();
		expect(screen.getByTestId("clip-strip-card-status-rail-clip-agent-pass").className).toContain(
			"bg-info-foreground",
		);
	});

	it("shows a pause control while the timeline is playing", () => {
		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={4}
				isPlaying={true}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "暂停片段条" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "播放片段条" })).toBeNull();
	});

	it("scrolls the clip strip horizontally with a vertical mouse wheel", () => {
		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const scroll = screen.getByTestId("episode-clip-strip-scroll");
		Object.defineProperty(scroll, "clientWidth", { value: 320, configurable: true });
		Object.defineProperty(scroll, "scrollWidth", { value: 960, configurable: true });

		fireEvent.wheel(scroll, { deltaX: 0, deltaY: 120 });

		expect(scroll.scrollLeft).toBe(120);
	});

	it("keeps native horizontal wheel movement available", () => {
		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const scroll = screen.getByTestId("episode-clip-strip-scroll");
		Object.defineProperty(scroll, "clientWidth", { value: 320, configurable: true });
		Object.defineProperty(scroll, "scrollWidth", { value: 960, configurable: true });
		scroll.scrollLeft = 48;

		fireEvent.wheel(scroll, { deltaX: 120, deltaY: 4 });

		expect(scroll.scrollLeft).toBe(48);
	});

	it("plays a clip when clicking the card body", () => {
		const onGenerateClip = vi.fn();
		const onPlayClip = vi.fn();

		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={onGenerateClip}
				onSeek={vi.fn()}
				onPlayClip={onPlayClip}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const card = screen.getByTestId("clip-strip-card-clip-problem");
		fireEvent.click(within(card).getByRole("button", { name: "定位到 问题铺垫" }));

		expect(onPlayClip).toHaveBeenCalledWith("clip-problem");
		expect(onGenerateClip).not.toHaveBeenCalled();
	});

	it("opens generation from the clip action button without seeking", () => {
		const onGenerateClip = vi.fn();
		const onSeek = vi.fn();
		const onSelectClip = vi.fn();

		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={onGenerateClip}
				onSeek={onSeek}
				onPlayClip={vi.fn()}
				onSelectClip={onSelectClip}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const card = screen.getByTestId("clip-strip-card-clip-problem");
		fireEvent.click(within(card).getByRole("button", { name: "生成 问题铺垫" }));

		expect(onGenerateClip).toHaveBeenCalledWith("clip-problem");
		expect(onSeek).not.toHaveBeenCalled();
		expect(onSelectClip).not.toHaveBeenCalled();
	});

	it("opens a disabled clip menu download action when the clip has no video", () => {
		const onDownloadClip = vi.fn();

		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onDownloadClip={onDownloadClip}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(screen.getByTestId("clip-strip-card-clip-cold-open"), {
			clientX: 64,
			clientY: 88,
		});

		const downloadItem = screen.getByRole("menuitem", { name: "下载当前视频" });
		expect((downloadItem as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(downloadItem);

		expect(onDownloadClip).not.toHaveBeenCalled();
	});

	it("downloads the right-clicked clip video from the clip menu", () => {
		const onDownloadClip = vi.fn();
		const onSelectClip = vi.fn();
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip) =>
								clip.id === "clip-problem"
									? { ...clip, videoUrl: "https://example.test/problem.mp4" }
									: clip,
							),
						}
					: track,
			),
		};

		render(
			<EpisodeTimelineEditor
				episode={episode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onDownloadClip={onDownloadClip}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={onSelectClip}
				onTogglePlayback={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(screen.getByTestId("clip-strip-card-clip-problem"), {
			clientX: 80,
			clientY: 96,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "下载当前视频" }));

		expect(onSelectClip).toHaveBeenCalledWith("clip-problem");
		expect(onDownloadClip).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "clip-problem",
				videoUrl: "https://example.test/problem.mp4",
			}),
		);
		expect(screen.queryByRole("menu", { name: "问题铺垫 分镜菜单" })).toBeNull();
	});

	it("renders a video thumbnail on clips with persisted video media", () => {
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip) =>
								clip.id === "clip-cold-open"
									? { ...clip, videoUrl: "https://example.test/generated.mp4" }
									: clip,
							),
						}
					: track,
			),
		};

		render(
			<EpisodeTimelineEditor
				episode={episode}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const card = screen.getByTestId("clip-strip-card-clip-cold-open");
		const video = card.querySelector("video");

		expect(video?.getAttribute("src")).toBe("https://example.test/generated.mp4");
	});

	it("uses real media duration for progress", () => {
		const onSeek = vi.fn();

		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				currentTime={4}
				isPlaying={true}
				selectedClipId="clip-cold-open"
				timelineDuration={45}
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={onSeek}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const progress = screen.getByTestId("clip-strip-progress");
		expect(screen.getByText("00:04")).toBeTruthy();
		expect(screen.getByText("00:45")).toBeTruthy();
		expect(progress.getAttribute("aria-valuemax")).toBe("45");

		Object.defineProperty(progress, "getBoundingClientRect", {
			value: () => ({ left: 0, width: 90 }),
			configurable: true,
		});
		fireEvent.pointerDown(progress, { button: 0, clientX: 45 });

		expect(onSeek).toHaveBeenCalledWith(22.5);
	});

	it("plays from a clip and uses metadata posters with cumulative durations", () => {
		const onPlayClip = vi.fn();
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip) => {
								if (clip.id === "clip-cold-open") {
									return { ...clip, videoUrl: "/api/v1/media-assets/asset-a/content" };
								}
								if (clip.id === "clip-problem") {
									return { ...clip, videoUrl: "/api/v1/media-assets/asset-b/content" };
								}
								return clip;
							}),
						}
					: track,
			),
		};

		render(
			<EpisodeTimelineEditor
				episode={episode}
				clipMedia={{
					"clip-cold-open": {
						duration: 5,
						posterUrl: "/api/v1/media-assets/asset-a/poster",
					},
					"clip-problem": {
						duration: 7,
					},
				}}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				timelineDuration={12}
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={onPlayClip}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const firstCard = screen.getByTestId("clip-strip-card-clip-cold-open");
		const secondCard = screen.getByTestId("clip-strip-card-clip-problem");
		const firstCardDuration = within(firstCard).getByText("00:05");

		expect(firstCardDuration.className).toContain("bottom-2");
		expect(firstCardDuration.className).toContain("right-2");
		expect(within(firstCard).queryByText("冷开场")).toBeNull();
		expect(firstCard.querySelector("img")?.getAttribute("src")).toBe(
			"/api/v1/media-assets/asset-a/poster",
		);

		fireEvent.click(within(secondCard).getByRole("button", { name: "定位到 问题铺垫" }));

		expect(onPlayClip).toHaveBeenCalledWith("clip-problem");
	});

	it("renders clip strip poster URLs against the packaged desktop server", () => {
		vi.stubEnv("DEV", false);
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;

		render(
			<EpisodeTimelineEditor
				episode={sampleEpisode}
				clipMedia={{
					"clip-cold-open": {
						duration: 5,
						posterUrl: "/api/v1/media-assets/asset-a/poster",
					},
				}}
				currentTime={0}
				isPlaying={false}
				selectedClipId="clip-cold-open"
				timelineDuration={12}
				zoom="fit"
				onRequestCompanionGeneration={vi.fn()}
				onGenerateClip={vi.fn()}
				onSeek={vi.fn()}
				onPlayClip={vi.fn()}
				onSelectClip={vi.fn()}
				onTogglePlayback={vi.fn()}
			/>,
		);

		const firstCard = screen.getByTestId("clip-strip-card-clip-cold-open");
		expect(firstCard.querySelector("img")).toHaveAttribute(
			"src",
			"http://127.0.0.1:48273/api/v1/media-assets/asset-a/poster",
		);
	});
});
