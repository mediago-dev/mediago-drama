import { afterEach, describe, expect, it, vi } from "vitest";
import {
	selectedGenerationAssetsKey,
	selectedGenerationAssetsQueryKey,
	type SelectedGenerationAssetsResponse,
} from "@/domains/generation/api/generation";
import {
	workspaceDocumentResourcesKey,
	workspaceStoryboardVideoResourcesKey,
} from "@/domains/workspace/api/workspace";
import { refreshSelectedGenerationAssetDependents } from "./refresh-selected-assets";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("swr", () => ({ mutate: mocks.mutate }));

describe("refreshSelectedGenerationAssetDependents", () => {
	afterEach(() => mocks.mutate.mockReset());

	it("revalidates the selected-assets cover cache and the resource count feeds", () => {
		refreshSelectedGenerationAssetDependents("project-1");

		expect(mocks.mutate).toHaveBeenCalledTimes(3);
		// The first call is a matcher that must catch every selected-assets
		// variant (filtered and unfiltered) for this project.
		const matcher = mocks.mutate.mock.calls[0][0] as (key: unknown) => boolean;
		expect(matcher([selectedGenerationAssetsKey, "project-1"])).toBe(true);
		expect(matcher([selectedGenerationAssetsKey, "project-1", "image"])).toBe(true);
		expect(matcher([selectedGenerationAssetsKey, "other"])).toBe(false);
		expect(matcher(["/generation/tasks", "project-1"])).toBe(false);

		expect(mocks.mutate).toHaveBeenCalledWith(workspaceDocumentResourcesKey("project-1"));
		expect(mocks.mutate).toHaveBeenCalledWith(workspaceStoryboardVideoResourcesKey("project-1"));
	});

	it("optimistically replaces the selected image in the project cover cache", () => {
		const selectedAsset = {
			assetIndex: -1,
			id: "selected-new",
			kind: "image" as const,
			mediaAssetId: "asset-new",
			resourceId: "character-1",
			resourceType: "character" as const,
			url: "/api/v1/media-assets/asset-new/content",
		};
		refreshSelectedGenerationAssetDependents("project-1", selectedAsset);

		expect(mocks.mutate).toHaveBeenCalledTimes(4);
		expect(mocks.mutate.mock.calls[0][0]).toEqual(selectedGenerationAssetsQueryKey("project-1"));
		expect(mocks.mutate.mock.calls[0][2]).toEqual({ revalidate: false });

		const updateCache = mocks.mutate.mock.calls[0][1] as (
			current: SelectedGenerationAssetsResponse,
		) => SelectedGenerationAssetsResponse;
		const updated = updateCache({
			assets: [
				{
					assetIndex: 0,
					id: "selected-old",
					kind: "image",
					mediaAssetId: "asset-old",
					resourceId: "character-1",
					resourceType: "character",
					url: "/api/v1/media-assets/asset-old/content",
				},
				{
					assetIndex: 0,
					id: "selected-other",
					kind: "image",
					mediaAssetId: "asset-other",
					resourceId: "character-2",
					resourceType: "character",
					url: "/api/v1/media-assets/asset-other/content",
				},
			],
		});

		expect(updated.assets.map((asset) => asset.mediaAssetId)).toEqual(["asset-other", "asset-new"]);
	});

	it("is a no-op for a missing project id", () => {
		refreshSelectedGenerationAssetDependents("");
		refreshSelectedGenerationAssetDependents(null);
		refreshSelectedGenerationAssetDependents(undefined);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it("uses the bound mutator from the active SWR provider", () => {
		const boundMutate = vi.fn();

		refreshSelectedGenerationAssetDependents("project-1", undefined, boundMutate);

		expect(boundMutate).toHaveBeenCalledTimes(3);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});
});
