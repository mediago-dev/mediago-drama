import type {
	GenerationAsset,
	GenerationKind,
	GenerationParam,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export const entryPromptText = (entry: GenerationEntry) => entry.prompt || entry.content || "";

export const clampNumber = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

export interface ResolvedParamGroup {
	id: string;
	label: string;
	params: GenerationParam[];
}

const paramGroupOrderByKind: Record<GenerationKind, string[]> = {
	image: ["size", "count", "other"],
	video: ["size", "duration", "other"],
	text: ["other"],
	audio: ["audio", "other"],
};

const paramGroupLabelByID: Record<string, string> = {
	size: "大小",
	duration: "秒数",
	count: "数量",
	voice: "音色",
	audio: "音频",
	other: "其他",
};

const paramGroupByName: Record<string, string> = {
	aspectRatio: "size",
	ratio: "size",
	resolution: "size",
	resolutionType: "size",
	imageSize: "size",
	duration: "duration",
	n: "count",
};

const uniqueValues = <T>(values: T[]) => Array.from(new Set(values));

export const resolveParamGroups = (route: GenerationRoute): ResolvedParamGroup[] => {
	if (route.paramGroups?.length) {
		const paramsByName = new Map(route.params.map((param) => [param.name, param]));
		return route.paramGroups.flatMap((group) => {
			const params = group.params
				.map((name) => paramsByName.get(name))
				.filter((param): param is GenerationParam => Boolean(param));
			if (params.length === 0) return [];

			return [{ id: group.id, label: group.label, params }];
		});
	}

	return deriveParamGroups(route.kind, route.params);
};

const deriveParamGroups = (
	kind: GenerationKind,
	params: GenerationParam[],
): ResolvedParamGroup[] => {
	const groups = new Map<string, GenerationParam[]>();
	for (const param of params) {
		const groupID = param.group || paramGroupByName[param.name] || "other";
		groups.set(groupID, [...(groups.get(groupID) ?? []), param]);
	}

	const orderedGroupIDs = uniqueValues([
		...(paramGroupOrderByKind[kind] ?? []),
		...Array.from(groups.keys()),
	]);
	return orderedGroupIDs.flatMap((groupID) => {
		const groupParams = groups.get(groupID) ?? [];
		if (groupParams.length === 0) return [];

		return [
			{
				id: groupID,
				label: paramGroupLabelByID[groupID] ?? "其他",
				params: groupParams,
			},
		];
	});
};

export interface GeneratedReferenceOption {
	entry: GenerationEntry | null;
	key: string;
	kind: ReferenceMediaAssetKind;
	mediaAsset: MediaAsset | null;
	source: string;
}

type ReferenceMediaAssetKind = Extract<MediaAsset["kind"], "image" | "video" | "audio">;

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
			options.push({
				entry,
				key,
				kind:
					mediaAsset && isReferenceMediaAssetKind(mediaAsset.kind) ? mediaAsset.kind : asset.kind,
				mediaAsset,
				source,
			});
		}
	}

	for (const asset of mediaAssets) {
		if (!isReferenceMediaAssetKind(asset.kind)) continue;
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
	const match = source.match(
		/\/api(?:\/v1)?\/(?:projects\/[^/]+\/)?(?:media\/assets|media-assets)\/([^/?#]+)\/content/i,
	);
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
		(asset): asset is typeof asset & { kind: ReferenceMediaAssetKind } =>
			(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") &&
			Boolean(generationAssetSource(asset)),
	) ?? [];

const isReferenceMediaAssetKind = (kind: MediaAsset["kind"]): kind is ReferenceMediaAssetKind =>
	kind === "image" || kind === "video" || kind === "audio";

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
