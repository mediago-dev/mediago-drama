import { beforeEach, describe, expect, it } from "vitest";
import { findEpisodeVideoClip } from "@/domains/episode/lib/filters";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import { useEpisodeStore } from "./store";

describe("episode store actions", () => {
	beforeEach(() => {
		useEpisodeStore.getState().setEpisode(sampleEpisode);
	});

	it("stores generated video media on the target video clip", () => {
		const nextEpisode = useEpisodeStore
			.getState()
			.setVideoClipVideoUrl("clip-cold-open", " https://example.test/generated.mp4 ");

		const clip = nextEpisode ? findEpisodeVideoClip(nextEpisode, "clip-cold-open") : null;

		expect(clip?.videoUrl).toBe("https://example.test/generated.mp4");
		expect(clip?.status).toBe("ready");
	});

	it("removes generated video media from the target video clip", () => {
		useEpisodeStore
			.getState()
			.setVideoClipVideoUrl("clip-cold-open", "https://example.test/generated.mp4");

		const nextEpisode = useEpisodeStore.getState().setVideoClipVideoUrl("clip-cold-open", null);
		const clip = nextEpisode ? findEpisodeVideoClip(nextEpisode, "clip-cold-open") : null;

		expect(clip?.videoUrl).toBeUndefined();
		expect(clip?.posterUrl).toBeUndefined();
		expect(clip?.thumbnailUrl).toBeUndefined();
		expect(clip?.status).toBe("draft");
	});

	it("updates video clip generation status without touching media", () => {
		const nextEpisode = useEpisodeStore
			.getState()
			.setVideoClipStatus("clip-cold-open", "generating");

		const clip = nextEpisode ? findEpisodeVideoClip(nextEpisode, "clip-cold-open") : null;

		expect(clip?.status).toBe("generating");
	});
});
