import { mutate as globalMutate } from "swr";
import {
	selectedGenerationAssetsKey,
	selectedGenerationAssetsQueryKey,
	type SelectedGenerationAsset,
	type SelectedGenerationAssetsResponse,
} from "@/domains/generation/api/generation";
import {
	workspaceDocumentResourcesKey,
	workspaceStoryboardVideoResourcesKey,
} from "@/domains/workspace/api/workspace";

// refreshSelectedGenerationAssetDependents revalidates every SWR cache that
// reflects a project's finalized (定稿) generation assets: the selected-assets
// list that drives resource covers (角色 · 图片和音频 grid, overview), and the
// document/storyboard resource feeds carrying the "已生成 N 张" counts. Call it
// whenever the selection changes outside the manual panel — e.g. after an agent
// run finishes generating or finalizing assets, which emits no SSE completion
// event for synchronously-polled image tasks.
export const refreshSelectedGenerationAssetDependents = (
	projectId: string | null | undefined,
	selectedAsset?: SelectedGenerationAsset,
	mutate: typeof globalMutate = globalMutate,
) => {
	const id = projectId?.trim();
	if (!id) return;
	if (selectedAsset) {
		void mutate(
			selectedGenerationAssetsQueryKey(id),
			(current: SelectedGenerationAssetsResponse | undefined) => ({
				...current,
				assets: replaceSelectedResourceAsset(current?.assets ?? [], selectedAsset),
			}),
			{ revalidate: false },
		);
	}
	void mutate(
		(key) => Array.isArray(key) && key[0] === selectedGenerationAssetsKey && key[1] === id,
	);
	void mutate(workspaceDocumentResourcesKey(id));
	void mutate(workspaceStoryboardVideoResourcesKey(id));
};

const replaceSelectedResourceAsset = (
	assets: SelectedGenerationAsset[],
	selectedAsset: SelectedGenerationAsset,
) => [
	...assets.filter(
		(asset) => asset.id !== selectedAsset.id && !sameSelectedResourceKind(asset, selectedAsset),
	),
	selectedAsset,
];

const sameSelectedResourceKind = (
	current: SelectedGenerationAsset,
	next: SelectedGenerationAsset,
) =>
	current.kind === next.kind &&
	current.resourceType === next.resourceType &&
	(current.resourceId?.trim() ?? "") === (next.resourceId?.trim() ?? "") &&
	// A single planned asset can intentionally have one generated image per
	// storyboard shot. Keep those records side by side; only replace the
	// record for the exact same shot binding.
	((current.shotIds ?? []).length === 0 ||
		(next.shotIds ?? []).length === 0 ||
		(new Set(current.shotIds ?? []).size === new Set(next.shotIds ?? []).size &&
			new Set(current.shotIds ?? []).size > 0 &&
			[...(current.shotIds ?? [])].every((shotId) => (next.shotIds ?? []).includes(shotId))));
