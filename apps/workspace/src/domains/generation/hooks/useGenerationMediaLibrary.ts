import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	deleteMediaAsset,
	getMediaAssets,
	mediaAssetsKey,
	updateMediaAsset,
} from "@/domains/workspace/api/media";
import { filterMediaAssets } from "./useGenerationWorkspace.helpers";

interface UseGenerationMediaLibraryOptions {
	mediaAssetProjectId: string;
	setError: (message: string | null) => void;
}

export const useGenerationMediaLibrary = ({
	mediaAssetProjectId,
	setError,
}: UseGenerationMediaLibraryOptions) => {
	const [activeMediaAssetId, setActiveMediaAssetId] = useState<string | null>(null);
	const [mediaKindFilter, setMediaKindFilter] = useState<"all" | "image" | "video">("all");
	const [mediaQuery, setMediaQuery] = useState("");
	const { data: mediaData, mutate: mutateMediaAssets } = useSWR(
		[mediaAssetsKey, mediaAssetProjectId],
		() => getMediaAssets({ projectId: mediaAssetProjectId }),
	);
	const mediaAssets = useMemo(() => mediaData?.assets ?? [], [mediaData?.assets]);
	const filteredMediaAssets = useMemo(
		() => filterMediaAssets(mediaAssets, mediaKindFilter, mediaQuery),
		[mediaAssets, mediaKindFilter, mediaQuery],
	);

	const removeMediaAsset = useCallback(
		async (asset: MediaAsset) => {
			setActiveMediaAssetId(asset.id);
			setError(null);
			try {
				const nextAssets = await deleteMediaAsset(asset.id, mediaAssetProjectId);
				await mutateMediaAssets(nextAssets, false);
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : "素材删除失败。";
				setError(message);
				return false;
			} finally {
				setActiveMediaAssetId(null);
			}
		},
		[mediaAssetProjectId, mutateMediaAssets, setError],
	);

	const renameMediaAsset = useCallback(
		async (asset: MediaAsset) => {
			const filename = window.prompt("重命名素材", asset.filename)?.trim();
			if (!filename || filename === asset.filename) return;

			setActiveMediaAssetId(asset.id);
			setError(null);
			try {
				await updateMediaAsset(asset.id, filename);
				await mutateMediaAssets();
			} catch (err) {
				const message = err instanceof Error ? err.message : "素材重命名失败。";
				setError(message);
			} finally {
				setActiveMediaAssetId(null);
			}
		},
		[mutateMediaAssets, setError],
	);

	return {
		activeMediaAssetId,
		filteredMediaAssets,
		mediaAssets,
		mediaKindFilter,
		mediaQuery,
		mutateMediaAssets,
		removeMediaAsset,
		renameMediaAsset,
		setMediaKindFilter,
		setMediaQuery,
	};
};
