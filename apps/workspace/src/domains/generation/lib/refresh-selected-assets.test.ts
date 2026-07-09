import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedGenerationAssetsKey } from "@/domains/generation/api/generation";
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

	it("is a no-op for a missing project id", () => {
		refreshSelectedGenerationAssetDependents("");
		refreshSelectedGenerationAssetDependents(null);
		refreshSelectedGenerationAssetDependents(undefined);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});
});
