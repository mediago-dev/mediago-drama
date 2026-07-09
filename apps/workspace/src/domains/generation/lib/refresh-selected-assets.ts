import { mutate as mutateSWR } from "swr";
import { selectedGenerationAssetsKey } from "@/domains/generation/api/generation";
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
export const refreshSelectedGenerationAssetDependents = (projectId: string | null | undefined) => {
	const id = projectId?.trim();
	if (!id) return;
	void mutateSWR(
		(key) => Array.isArray(key) && key[0] === selectedGenerationAssetsKey && key[1] === id,
	);
	void mutateSWR(workspaceDocumentResourcesKey(id));
	void mutateSWR(workspaceStoryboardVideoResourcesKey(id));
};
