import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
	buildGeneratedReferenceOptions,
	mediaAssetIdFromGeneratedSource,
} from "./mediaGenerationHelpers";

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: "image-1",
	filename: "hero.png",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	url: "/api/v1/media-assets/image-1/content",
	createdAt: "2026-06-12T00:00:00.000Z",
	updatedAt: "2026-06-12T00:00:00.000Z",
	...overrides,
});

const generationEntry = (overrides: Partial<GenerationEntry> = {}): GenerationEntry => ({
	id: "task-1",
	kind: "image",
	status: "completed",
	content: "",
	prompt: "make a hero image",
	assets: [],
	...overrides,
});

describe("media generation helpers", () => {
	it("includes current project image and video assets even when generation history is empty", () => {
		const options = buildGeneratedReferenceOptions(
			[],
			[
				mediaAsset(),
				mediaAsset({
					id: "video-1",
					filename: "clip.mp4",
					kind: "video",
					mimeType: "video/mp4",
					url: "/api/v1/media-assets/video-1/content",
				}),
			],
		);

		expect(options).toHaveLength(2);
		expect(options[0]).toMatchObject({
			entry: null,
			kind: "image",
			key: "image-1",
			mediaAsset: expect.objectContaining({ id: "image-1" }),
			source: "/api/v1/media-assets/image-1/content",
		});
		expect(options[1]).toMatchObject({
			entry: null,
			kind: "video",
			key: "video-1",
			mediaAsset: expect.objectContaining({ id: "video-1" }),
			source: "/api/v1/media-assets/video-1/content",
		});
	});

	it("excludes text assets from generation reference options", () => {
		const options = buildGeneratedReferenceOptions(
			[
				generationEntry({
					assets: [{ kind: "text", url: "/api/v1/media-assets/text-1/content" }],
				}),
			],
			[
				mediaAsset({
					id: "text-1",
					filename: "notes.txt",
					kind: "text",
					mimeType: "text/plain",
					url: "/api/v1/media-assets/text-1/content",
				}),
			],
		);

		expect(options).toEqual([]);
	});

	it("deduplicates generated media that are already present in project media assets", () => {
		const entry = generationEntry({
			assets: [
				{ kind: "image", url: "/api/v1/media-assets/image-1/content" },
				{ kind: "video", url: "/api/v1/media-assets/video-1/content" },
			],
		});

		const videoAsset = mediaAsset({
			id: "video-1",
			filename: "clip.mp4",
			kind: "video",
			mimeType: "video/mp4",
			url: "/api/v1/media-assets/video-1/content",
		});
		const options = buildGeneratedReferenceOptions([entry], [mediaAsset(), videoAsset]);

		expect(options).toHaveLength(2);
		expect(options[0]).toMatchObject({
			entry,
			kind: "image",
			key: "image-1",
			mediaAsset: expect.objectContaining({ id: "image-1" }),
		});
		expect(options[1]).toMatchObject({
			entry,
			kind: "video",
			key: "video-1",
			mediaAsset: expect.objectContaining({ id: "video-1" }),
		});
	});

	it("extracts media asset ids from current and legacy content URLs", () => {
		expect(mediaAssetIdFromGeneratedSource("/api/v1/media-assets/image-1/content")).toBe("image-1");
		expect(mediaAssetIdFromGeneratedSource("/api/media/assets/image-2/content")).toBe("image-2");
	});
});
