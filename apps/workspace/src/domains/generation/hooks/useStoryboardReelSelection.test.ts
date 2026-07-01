import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { selectedGenerationAssetSelectionKey } from "@/domains/generation/lib/selected-asset-keys";
import { useStoryboardReelSelection } from "./useStoryboardReelSelection";

const selectedAsset = (
	overrides: Partial<SelectedGenerationAsset> = {},
): SelectedGenerationAsset => ({
	assetIndex: 0,
	id: "selected-asset",
	kind: "video",
	resourceType: "storyboard",
	...overrides,
});

const renderSelection = (...args: Parameters<typeof useStoryboardReelSelection>) =>
	renderHook(() => useStoryboardReelSelection(...args)).result;

describe("useStoryboardReelSelection", () => {
	afterEach(cleanup);

	it("derives the selection target from the reel section", () => {
		const result = renderSelection(
			"project-a",
			{ documentId: " story-doc ", sectionId: " section-7 ", title: "分镜7" },
			{ selectedGenerationAssets: [] },
		);

		expect(result.current.canSelect).toBe(true);
		expect(result.current.selectedAssetResourceId).toBe("section-7");
		expect(result.current.selectedAssetResourceType).toBe("storyboard");
		expect(result.current.selectedAssetSourceDocumentId).toBe("story-doc");
		expect(result.current.selectedAssetTitle).toBe("分镜7");
		expect(result.current.selectedAssetKeys).toEqual([]);
	});

	it("collects selected video keys for the section and ignores non-matching assets", () => {
		const match = selectedAsset({
			id: "video-match",
			resourceId: "section-7",
			sourceDocumentId: "story-doc",
			url: "/api/media/assets/video-match/content",
		});
		const wrongKind = selectedAsset({
			id: "image-other",
			kind: "image",
			resourceId: "section-7",
			sourceDocumentId: "story-doc",
			url: "/api/media/assets/image-other/content",
		});
		const wrongSection = selectedAsset({
			id: "video-other-section",
			resourceId: "section-8",
			sourceDocumentId: "story-doc",
			url: "/api/media/assets/video-other-section/content",
		});

		const result = renderSelection(
			"project-a",
			{ documentId: "story-doc", sectionId: "section-7" },
			{ selectedGenerationAssets: [match, wrongKind, wrongSection] },
		);

		expect(result.current.selectedAssetKeys).toEqual([selectedGenerationAssetSelectionKey(match)]);
		expect(result.current.selectedAssetTitle).toBeUndefined();
	});

	it("cannot select without both documentId and sectionId", () => {
		const result = renderSelection(
			"project-a",
			{ documentId: "story-doc", sectionId: "", title: "分镜7" },
			{ selectedGenerationAssets: [] },
		);

		expect(result.current.canSelect).toBe(false);
		expect(result.current.selectedAssetResourceId).toBeUndefined();
		expect(result.current.selectedAssetResourceType).toBeUndefined();
		expect(result.current.selectedAssetSourceDocumentId).toBeUndefined();
		expect(result.current.selectedAssetKeys).toEqual([]);
	});

	it("treats a null target as not selectable", () => {
		const result = renderSelection("project-a", null, { selectedGenerationAssets: [] });

		expect(result.current.canSelect).toBe(false);
		expect(result.current.selectedAssetKeys).toEqual([]);
	});
});
