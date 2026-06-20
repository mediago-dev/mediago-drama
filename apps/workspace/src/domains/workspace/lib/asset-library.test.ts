import { describe, expect, it } from "vitest";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	buildAssetLibraryItems,
	filterAssetLibraryItems,
	mediaAssetIdFromURL,
	normalizedAssetURL,
} from "./asset-library";

describe("asset-library", () => {
	it("merges selected generated assets into matching media assets", () => {
		const items = buildAssetLibraryItems({
			mediaAssets: [
				mediaAsset({
					id: "media-a",
					url: "/api/v1/media-assets/media-a/content",
				}),
			],
			selectedAssets: [
				selectedAsset({
					id: "selected-a",
					resourceType: "character",
					taskId: "task-a",
					url: "/api/v1/media-assets/media-a/content",
				}),
			],
		});

		expect(items).toHaveLength(1);
		const mediaItem = items.find((item) => item.key === "media:media-a");
		expect(mediaItem?.selectedAssets.map((asset) => asset.id)).toEqual(["selected-a"]);
		expect(mediaItem?.selectedResourceTypes).toEqual(["character"]);
		expect(items.some((item) => item.key === "selected:selected-a")).toBe(false);
	});

	it("merges selected assets by explicit media asset id", () => {
		const items = buildAssetLibraryItems({
			mediaAssets: [
				mediaAsset({ id: "media-direct", url: "/api/v1/media-assets/media-direct/content" }),
			],
			selectedAssets: [
				selectedAsset({
					id: "selected-direct",
					mediaAssetId: "media-direct",
					resourceType: "character",
					url: "",
				}),
			],
		});

		expect(items).toHaveLength(1);
		expect(items[0].key).toBe("media:media-direct");
		expect(items[0].selectedAssets.map((asset) => asset.id)).toEqual(["selected-direct"]);
	});

	it("keeps unmatched selected generated assets as read-only items", () => {
		const items = buildAssetLibraryItems({
			selectedAssets: [
				selectedAsset({
					id: "selected-orphan",
					resourceType: "scene",
					title: "雨夜街角",
					url: "/api/v1/media-assets/missing/content",
				}),
			],
		});

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			key: "selected:selected-orphan",
			sourceType: "selected",
			title: "雨夜街角",
			selectedResourceTypes: ["scene"],
		});
	});

	it("filters by kind, source, resource type, and query", () => {
		const items = buildAssetLibraryItems({
			mediaAssets: [
				mediaAsset({
					filename: "Hero still.png",
					id: "hero",
					kind: "image",
					url: "/api/v1/media-assets/hero/content",
				}),
				mediaAsset({
					filename: "Audio take.wav",
					id: "audio",
					kind: "audio",
					url: "/api/v1/media-assets/audio/content",
				}),
			],
			selectedAssets: [
				selectedAsset({
					resourceType: "prop",
					taskId: "task-prop",
					url: "/api/v1/media-assets/hero/content",
				}),
			],
		});

		expect(filterAssetLibraryItems(items, { kind: "image" }).map((item) => item.id)).toEqual([
			"hero",
		]);
		expect(filterAssetLibraryItems(items, { source: "media" })).toHaveLength(2);
		expect(filterAssetLibraryItems(items, { resourceType: "prop" }).map((item) => item.id)).toEqual(
			["hero"],
		);
		expect(filterAssetLibraryItems(items, { query: "audio" }).map((item) => item.id)).toEqual([
			"audio",
		]);
	});

	it("normalizes media content urls", () => {
		expect(mediaAssetIdFromURL("/api/v1/media-assets/media%20a/content")).toBe("media a");
		expect(mediaAssetIdFromURL("http://127.0.0.1:48273/api/v1/media-assets/media-b/content")).toBe(
			"media-b",
		);
		expect(normalizedAssetURL("http://127.0.0.1:48273/api/v1/media-assets/media-b/content")).toBe(
			"/api/v1/media-assets/media-b/content",
		);
	});
});

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	createdAt: "2026-06-01T08:00:00Z",
	filename: "media.png",
	id: "media-a",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-06-01T09:00:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});

const selectedAsset = (
	overrides: Partial<SelectedGenerationAsset> = {},
): SelectedGenerationAsset => ({
	assetIndex: 0,
	createdAt: "2026-06-01T10:00:00Z",
	id: "selected-a",
	kind: "image",
	mimeType: "image/png",
	resourceType: "character",
	taskId: "task-a",
	title: "selected image",
	updatedAt: "2026-06-01T10:30:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});
