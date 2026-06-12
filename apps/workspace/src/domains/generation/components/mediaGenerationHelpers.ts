import type { GenerationAsset, GenerationKind } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export const entryPromptText = (entry: GenerationEntry) => entry.prompt || entry.content || "";

export const clampNumber = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

export interface GeneratedReferenceOption {
	entry: GenerationEntry | null;
	key: string;
	kind: MediaAsset["kind"];
	mediaAsset: MediaAsset | null;
	source: string;
}

export const buildGeneratedReferenceOptions = (
	entries: GenerationEntry[],
	mediaAssets: MediaAsset[],
): GeneratedReferenceOption[] => {
	const seen = new Set<string>();
	const options: GeneratedReferenceOption[] = [];

	for (const entry of entries) {
		for (const asset of entryReferenceAssets(entry)) {
			const source = generationAssetSource(asset);
			if (!source) continue;

			const mediaAsset = findMediaAssetForGeneratedSource(source, mediaAssets);
			const key = mediaAsset?.id ?? `${entry.id}:${source}`;
			if (seen.has(key) || seen.has(source)) continue;

			seen.add(key);
			seen.add(source);
			options.push({ entry, key, kind: mediaAsset?.kind ?? asset.kind, mediaAsset, source });
		}
	}

	for (const asset of mediaAssets) {
		const source = generationAssetSource({
			kind: asset.kind,
			url: asset.url,
			mimeType: asset.mimeType,
		});
		if (!source || seen.has(asset.id) || seen.has(source)) continue;

		seen.add(asset.id);
		seen.add(source);
		options.push({
			entry: null,
			key: asset.id,
			kind: asset.kind,
			mediaAsset: asset,
			source,
		});
	}

	return options;
};

export const findMediaAssetForGeneratedSource = (source: string, mediaAssets: MediaAsset[]) => {
	const mediaAssetId = mediaAssetIdFromGeneratedSource(source);

	return (
		mediaAssets.find(
			(asset) =>
				(mediaAssetId && asset.id === mediaAssetId) ||
				asset.url === source ||
				asset.sourceUrl === source,
		) ?? null
	);
};

export const mediaAssetIdFromGeneratedSource = (source: string) => {
	const match = source.match(/\/api(?:\/v1)?\/(?:media\/assets|media-assets)\/([^/?#]+)\/content/);
	if (!match?.[1]) return null;

	return decodeURIComponent(match[1]);
};

export const mergeReferencePreviewAssets = (
	manualReferences: MediaAsset[],
	extraReferences: MediaAsset[],
) => {
	const seen = new Set<string>();
	const references: MediaAsset[] = [];

	for (const asset of [...manualReferences, ...extraReferences]) {
		if (seen.has(asset.id)) continue;

		seen.add(asset.id);
		references.push(asset);
	}

	return references;
};

export const entryGeneratedAssets = (entry: GenerationEntry, kind: GenerationKind) =>
	entry.assets?.filter((asset) => asset.kind === kind && generationAssetSource(asset)) ?? [];

export const entryImageAssets = (entry: GenerationEntry) => entryGeneratedAssets(entry, "image");

export const entryReferenceAssets = (entry: GenerationEntry) =>
	entry.assets?.filter(
		(asset): asset is typeof asset & { kind: MediaAsset["kind"] } =>
			(asset.kind === "image" || asset.kind === "video") && Boolean(generationAssetSource(asset)),
	) ?? [];

export const entrySelectionState = (assets: GenerationAsset[], selectedAssetKeys: string[]) => {
	const selectableAssets = assets.filter((asset) => generationAssetSelectionKey(asset));
	const selectedCount = selectableAssets.filter((asset) => {
		const assetKey = generationAssetSelectionKey(asset);
		return Boolean(assetKey && selectedAssetKeys.includes(assetKey));
	}).length;

	return {
		allSelected: selectableAssets.length > 0 && selectedCount === selectableAssets.length,
		partiallySelected: selectedCount > 0 && selectedCount < selectableAssets.length,
		selectableAssets,
		selectedCount,
	};
};

export type EntrySelectionState = ReturnType<typeof entrySelectionState>;

export const historySelectionText = (selection: EntrySelectionState) => {
	if (selection.allSelected) return "已选";
	if (selection.partiallySelected)
		return `${selection.selectedCount}/${selection.selectableAssets.length}`;
	return "选入";
};

const failedGenerationStatuses = new Set(["failed", "error", "cancelled", "canceled"]);
const pendingGenerationStatuses = new Set([
	"loading",
	"submitting",
	"pending",
	"processing",
	"queued",
	"running",
	"submitted",
]);

export const isFailedGenerationStatus = (status?: string) =>
	failedGenerationStatuses.has(String(status ?? "").toLowerCase());

export const isPendingGenerationStatus = (status?: string) =>
	pendingGenerationStatuses.has(String(status ?? "").toLowerCase());
