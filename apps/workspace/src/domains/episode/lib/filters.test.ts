import { describe, expect, it } from "vitest";
import {
	findEpisodeClip,
	findEpisodeTrackForClip,
	findEpisodeVideoClip,
	getClipCount,
	getPlayableEpisodeVideoClips,
	getVisibleEpisodeTimelineClipCount,
	getVisibleEpisodeTimelineTracks,
} from "@/domains/episode/lib/filters";
import type { Episode } from "@/domains/episode/lib/sample";

const episode: Episode = {
	id: "episode",
	title: "Episode",
	duration: 12,
	aspectRatio: "16:9",
	sections: [],
	tracks: [
		{
			id: "track-video",
			type: "video",
			label: "Video",
			clips: [
				{
					id: "clip-video",
					title: "Video",
					start: 0,
					end: 6,
					content: "Video",
					status: "ready",
				},
			],
		},
		{
			id: "track-caption",
			type: "caption",
			label: "Caption",
			clips: [
				{
					id: "clip-caption",
					title: "Caption",
					start: 0,
					end: 6,
					content: "Caption",
					status: "draft",
				},
			],
		},
	],
};

describe("episode filters", () => {
	it("finds clips and their owning tracks", () => {
		expect(findEpisodeClip(episode, "clip-caption")?.title).toBe("Caption");
		expect(findEpisodeTrackForClip(episode, "clip-caption")?.id).toBe("track-caption");
		expect(findEpisodeClip(episode, "missing")).toBeNull();
	});

	it("counts clips across tracks", () => {
		expect(getClipCount(episode)).toBe(2);
	});

	it("returns only currently visible timeline tracks", () => {
		expect(getVisibleEpisodeTimelineTracks(episode).map((track) => track.id)).toEqual([
			"track-video",
		]);
		expect(getVisibleEpisodeTimelineClipCount(episode)).toBe(1);
	});

	it("selects video clips by track type", () => {
		expect(findEpisodeVideoClip(episode, "clip-video")?.id).toBe("clip-video");
		expect(findEpisodeVideoClip(episode, "clip-caption")).toBeNull();
	});

	it("returns only the continuous ready video prefix", () => {
		const clips = getPlayableEpisodeVideoClips({
			...episode,
			tracks: [
				{
					id: "track-video",
					type: "video",
					label: "Video",
					clips: [
						{
							id: "clip-2",
							title: "Video 2",
							start: 6,
							end: 12,
							content: "Video",
							status: "ready",
							videoUrl: "/api/v1/media-assets/asset-2/content",
						},
						{
							id: "clip-1",
							title: "Video 1",
							start: 0,
							end: 6,
							content: "Video",
							status: "ready",
							videoUrl: "/api/v1/media-assets/asset-1/content",
						},
						{
							id: "clip-3",
							title: "Video 3",
							start: 12,
							end: 18,
							content: "Video",
							status: "draft",
							videoUrl: "/api/v1/media-assets/asset-3/content",
						},
					],
				},
			],
		});

		expect(clips.map((clip) => clip.id)).toEqual(["clip-1", "clip-2"]);
	});
});
