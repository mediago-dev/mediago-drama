import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyedMutator } from "swr";
import type { MediaAsset, MediaAssetsResponse } from "@/domains/workspace/api/media";
import { uploadMediaAsset } from "@/domains/workspace/api/media";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import {
	canUseAssetAsReference,
	referenceKindsForRoute,
	resolveGenerationExtraValue,
	uniqueStrings,
	type GenerationExtraValue,
} from "./useGenerationWorkspace.helpers";

interface UseGenerationReferencesOptions {
	extraReferenceAssetIds: GenerationExtraValue<string[]>;
	extraReferenceUrls: GenerationExtraValue<string[]>;
	mediaAssetProjectId: string;
	mediaAssets: MediaAsset[];
	mutateMediaAssets: KeyedMutator<MediaAssetsResponse>;
	prompt: string;
	selectedRoute: GenerationRoute;
	setError: (message: string | null) => void;
}

export const useGenerationReferences = ({
	extraReferenceAssetIds,
	extraReferenceUrls,
	mediaAssetProjectId,
	mediaAssets,
	mutateMediaAssets,
	prompt,
	selectedRoute,
	setError,
}: UseGenerationReferencesOptions) => {
	const [selectedReferenceAssetIds, setSelectedReferenceAssetIds] = useState<string[]>([]);
	const [isUploadingAsset, setIsUploadingAsset] = useState(false);
	const selectableReferenceKinds = useMemo(
		() => referenceKindsForRoute(selectedRoute),
		[selectedRoute],
	);
	const selectedReferenceAssets = useMemo(
		() => mediaAssets.filter((asset) => selectedReferenceAssetIds.includes(asset.id)),
		[mediaAssets, selectedReferenceAssetIds],
	);
	const resolvedExtraReferenceAssetIds = useMemo(
		() => resolveGenerationExtraValue(extraReferenceAssetIds, prompt),
		[extraReferenceAssetIds, prompt],
	);
	const resolvedExtraReferenceUrls = useMemo(
		() => resolveGenerationExtraValue(extraReferenceUrls, prompt),
		[extraReferenceUrls, prompt],
	);
	const effectiveReferenceAssetIds = useMemo(
		() => uniqueStrings([...selectedReferenceAssetIds, ...resolvedExtraReferenceAssetIds]),
		[resolvedExtraReferenceAssetIds, selectedReferenceAssetIds],
	);
	const effectiveReferenceUrls = useMemo(
		() => uniqueStrings(resolvedExtraReferenceUrls.map((url) => url.trim()).filter(Boolean)),
		[resolvedExtraReferenceUrls],
	);
	const referenceCount = effectiveReferenceAssetIds.length + effectiveReferenceUrls.length;

	useEffect(() => {
		if (mediaAssets.length === 0) {
			setSelectedReferenceAssetIds((current) => (current.length === 0 ? current : []));
			return;
		}

		const validIDs = new Set(
			mediaAssets
				.filter((asset) => canUseAssetAsReference(asset, selectedRoute, selectableReferenceKinds))
				.map((asset) => asset.id),
		);
		setSelectedReferenceAssetIds((current) => {
			const next = current.filter((id) => validIDs.has(id));
			return sameStringList(current, next) ? current : next;
		});
	}, [mediaAssets, selectableReferenceKinds, selectedRoute]);

	const removeReferenceAsset = useCallback((assetId: string) => {
		setSelectedReferenceAssetIds((current) => current.filter((id) => id !== assetId));
	}, []);

	const selectReferenceAsset = useCallback(
		(asset: MediaAsset) => {
			if (!canUseAssetAsReference(asset, selectedRoute, selectableReferenceKinds)) return;

			setSelectedReferenceAssetIds((current) =>
				current.includes(asset.id) ? current : [...current, asset.id],
			);
		},
		[selectableReferenceKinds, selectedRoute],
	);

	const toggleReferenceAsset = useCallback(
		(asset: MediaAsset) => {
			if (!canUseAssetAsReference(asset, selectedRoute, selectableReferenceKinds)) return;

			setSelectedReferenceAssetIds((current) =>
				current.includes(asset.id)
					? current.filter((id) => id !== asset.id)
					: [...current, asset.id],
			);
		},
		[selectableReferenceKinds, selectedRoute],
	);

	const uploadReferenceAsset = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;

			setIsUploadingAsset(true);
			setError(null);
			try {
				const asset = await uploadMediaAsset(file, mediaAssetProjectId);
				await mutateMediaAssets();
				if (canUseAssetAsReference(asset, selectedRoute, selectableReferenceKinds)) {
					setSelectedReferenceAssetIds((current) =>
						current.includes(asset.id) ? current : [...current, asset.id],
					);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : "素材上传失败。";
				setError(message);
			} finally {
				setIsUploadingAsset(false);
			}
		},
		[mediaAssetProjectId, mutateMediaAssets, selectableReferenceKinds, selectedRoute, setError],
	);

	return {
		effectiveReferenceAssetIds,
		effectiveReferenceUrls,
		isUploadingAsset,
		referenceCount,
		removeReferenceAsset,
		selectReferenceAsset,
		selectableReferenceKinds,
		selectedReferenceAssetIds,
		selectedReferenceAssets,
		toggleReferenceAsset,
		uploadReferenceAsset,
	};
};

const sameStringList = (left: string[], right: string[]) =>
	left.length === right.length && left.every((value, index) => value === right[index]);
