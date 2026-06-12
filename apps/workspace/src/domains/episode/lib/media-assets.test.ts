import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import {
	buildEpisodeVideoClipPlaybackRanges,
	buildEpisodeClipMedia,
	episodeClipPosterUrl,
	findEpisodeClipPlaybackRangeAtTime,
	findMediaAssetForClipVideo,
	isEpisodeVideoClipPlayable,
	mediaAssetIdFromContentURL,
} from "./media-assets";

const videoAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: "asset-1",
	kind: "video",
	filename: "clip.mp4",
	mimeType: "video/mp4",
	sizeBytes: 1024,
	url: "/api/v1/media-assets/asset-1/content",
	durationSeconds: 4.8,
	posterUrl: "/api/v1/media-assets/asset-1/poster",
	createdAt: "2026-06-12T00:00:00.000Z",
	updatedAt: "2026-06-12T00:00:00.000Z",
	...overrides,
});

describe("episode media asset helpers", () => {
	it("extracts media asset ids from relative, absolute, and project content URLs", () => {
		expect(mediaAssetIdFromContentURL("/api/v1/media-assets/asset-1/content")).toBe("asset-1");
		expect(
			mediaAssetIdFromContentURL("http://127.0.0.1:48273/api/v1/media-assets/asset-2/content"),
		).toBe("asset-2");
		expect(
			mediaAssetIdFromContentURL("/api/v1/projects/project-a/media-assets/asset%203/content"),
		).toBe("asset 3");
	});

	it("matches clip video URLs to media assets by id before URL shape", () => {
		const asset = videoAsset({ id: "asset-2", url: "/api/v1/media-assets/asset-2/content" });

		expect(
			findMediaAssetForClipVideo(
				"http://127.0.0.1:48273/api/v1/projects/project-a/media-assets/asset-2/content",
				[asset],
			),
		).toBe(asset);
	});

	it("builds clip media from absolute clip URLs and relative asset URLs", () => {
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip) =>
								clip.id === "clip-cold-open"
									? {
											...clip,
											videoUrl: "http://127.0.0.1:48273/api/v1/media-assets/asset-1/content",
										}
									: clip,
							),
						}
					: track,
			),
		};

		const media = buildEpisodeClipMedia(episode, [videoAsset()]);

		expect(media?.["clip-cold-open"]).toEqual({
			duration: 4.8,
			posterUrl: "/api/v1/media-assets/asset-1/poster",
		});
	});

	it("resolves clip poster URLs from media, poster, then thumbnail", () => {
		const clip = {
			...sampleEpisode.tracks[0]!.clips[0]!,
			posterUrl: "/clip-poster.jpg",
			thumbnailUrl: "/clip-thumbnail.jpg",
		};

		expect(episodeClipPosterUrl(clip, { duration: 4, posterUrl: "/asset-poster.jpg" })).toBe(
			"/asset-poster.jpg",
		);
		expect(episodeClipPosterUrl(clip)).toBe("/clip-poster.jpg");
		expect(episodeClipPosterUrl({ ...clip, posterUrl: "" })).toBe("/clip-thumbnail.jpg");
	});

	it("builds cumulative playback ranges only for generated video clips", () => {
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip) => {
								if (clip.id === "clip-cold-open") {
									return {
										...clip,
										status: "ready" as const,
										videoUrl: "/api/v1/media-assets/asset-1/content",
									};
								}
								if (clip.id === "clip-problem") {
									return {
										...clip,
										status: "ready" as const,
										videoUrl: "/api/v1/media-assets/asset-2/content",
									};
								}
								return clip;
							}),
						}
					: track,
			),
		};
		const media = {
			"clip-cold-open": {
				duration: 5,
			},
		};

		const ranges = buildEpisodeVideoClipPlaybackRanges(episode, media);

		expect(ranges[0]).toMatchObject({
			start: 0,
			end: 5,
			duration: 5,
			index: 0,
		});
		expect(ranges[1]).toMatchObject({
			start: 5,
			end: 13,
			duration: 8,
			index: 1,
		});
		expect(ranges[2]).toMatchObject({
			start: 13,
			end: 13,
			duration: 0,
			index: 2,
		});
	});

	it("falls back to the final playable range when time is outside the timeline", () => {
		const episode = {
			...sampleEpisode,
			tracks: sampleEpisode.tracks.map((track) =>
				track.type === "video"
					? {
							...track,
							clips: track.clips.map((clip, index) =>
								index < 2
									? {
											...clip,
											status: "ready" as const,
											videoUrl: `/api/v1/media-assets/asset-${index + 1}/content`,
										}
									: clip,
							),
						}
					: track,
			),
		};

		const ranges = buildEpisodeVideoClipPlaybackRanges(episode);

		expect(findEpisodeClipPlaybackRangeAtTime(ranges, 999)?.clip.id).toBe("clip-problem");
	});

	it("treats only ready clips with video URLs as playable", () => {
		const readyClip = {
			...sampleEpisode.tracks[0]!.clips[0]!,
			status: "ready" as const,
			videoUrl: "/api/v1/media-assets/asset-1/content",
		};
		const draftClip = { ...readyClip, status: "draft" as const };
		const missingVideoClip = { ...readyClip, videoUrl: "" };

		expect(isEpisodeVideoClipPlayable(readyClip)).toBe(true);
		expect(isEpisodeVideoClipPlayable(draftClip)).toBe(false);
		expect(isEpisodeVideoClipPlayable(missingVideoClip)).toBe(false);
	});
});
