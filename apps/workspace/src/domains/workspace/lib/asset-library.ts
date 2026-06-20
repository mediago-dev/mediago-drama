import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { AgentResourceType } from "@/domains/workspace/lib/workbench-route";

export type AssetLibraryKind = "image" | "video" | "audio" | "text" | "binary";
export type AssetLibrarySource = "media" | "selected";
export type AssetLibraryKindFilter = "all" | AssetLibraryKind;
export type AssetLibrarySourceFilter = "all" | AssetLibrarySource;
export type AssetLibraryResourceFilter = "all" | AgentResourceType;
export type AssetLibrarySort = "updatedDesc" | "createdDesc" | "nameAsc" | "sizeDesc";

export interface AssetLibraryItem {
	createdAt: string;
	id: string;
	key: string;
	kind: AssetLibraryKind;
	mediaAsset?: MediaAsset;
	mimeType: string;
	selectedAssets: SelectedGenerationAsset[];
	selectedResourceTypes: AgentResourceType[];
	sizeBytes: number;
	sourceType: AssetLibrarySource;
	title: string;
	updatedAt: string;
	url: string;
}

export interface BuildAssetLibraryItemsInput {
	mediaAssets?: MediaAsset[];
	selectedAssets?: SelectedGenerationAsset[];
}

export interface FilterAssetLibraryItemsOptions {
	kind?: AssetLibraryKindFilter;
	query?: string;
	resourceType?: AssetLibraryResourceFilter;
	sort?: AssetLibrarySort;
	source?: AssetLibrarySourceFilter;
}

const mediaContentURLPattern =
	/\/api(?:\/v1)?\/(?:projects\/[^/]+\/)?(?:media\/assets|media-assets)\/([^/?#]+)\/content/i;

export const buildAssetLibraryItems = ({
	mediaAssets = [],
	selectedAssets = [],
}: BuildAssetLibraryItemsInput): AssetLibraryItem[] => {
	const items: AssetLibraryItem[] = [];
	const mediaItemByMatchKey = new Map<string, AssetLibraryItem>();
	const selectedAssetIDs = new Set<string>();

	for (const asset of mediaAssets) {
		const item: AssetLibraryItem = {
			createdAt: asset.createdAt,
			id: asset.id,
			key: `media:${asset.id}`,
			kind: asset.kind,
			mediaAsset: asset,
			mimeType: asset.mimeType,
			selectedAssets: [],
			selectedResourceTypes: [],
			sizeBytes: asset.sizeBytes,
			sourceType: "media",
			title: asset.filename || "untitled",
			updatedAt: asset.updatedAt,
			url: asset.url,
		};
		items.push(item);
		for (const key of mediaMatchKeys(asset)) mediaItemByMatchKey.set(key, item);
	}

	for (const asset of selectedAssets) {
		const match = selectedAssetMatchKeys(asset)
			.map((key) => mediaItemByMatchKey.get(key))
			.find(Boolean);
		if (match) {
			if (!selectedAssetIDs.has(selectedAssetID(asset))) {
				match.selectedAssets.push(asset);
				match.selectedResourceTypes = uniqueResourceTypes([
					...match.selectedResourceTypes,
					asset.resourceType,
				]);
				selectedAssetIDs.add(selectedAssetID(asset));
			}
			continue;
		}

		items.push({
			createdAt: asset.createdAt ?? "",
			id: asset.id,
			key: `selected:${asset.id}`,
			kind: normalizeAssetKind(asset.kind),
			mimeType: asset.mimeType ?? "",
			selectedAssets: [asset],
			selectedResourceTypes: [asset.resourceType],
			sizeBytes: 0,
			sourceType: "selected",
			title: asset.title?.trim() || "untitled",
			updatedAt: asset.updatedAt ?? asset.createdAt ?? "",
			url: asset.url ?? "",
		});
	}

	return items;
};

export const filterAssetLibraryItems = (
	items: AssetLibraryItem[],
	{
		kind = "all",
		query = "",
		resourceType = "all",
		sort = "updatedDesc",
		source = "all",
	}: FilterAssetLibraryItemsOptions = {},
) => {
	const normalizedQuery = query.trim().toLowerCase();
	const filtered = items.filter((item) => {
		if (kind !== "all" && item.kind !== kind) return false;
		if (source !== "all" && item.sourceType !== source) return false;
		if (resourceType !== "all" && !item.selectedResourceTypes.includes(resourceType)) return false;
		if (!normalizedQuery) return true;
		return [
			item.title,
			item.mimeType,
			item.kind,
			item.sourceType,
			item.mediaAsset?.source ?? "",
			item.mediaAsset?.relativePath ?? "",
			item.mediaAsset?.conversationId ?? "",
			item.mediaAsset?.sectionId ?? "",
			...item.selectedResourceTypes,
		].some((value) => value.toLowerCase().includes(normalizedQuery));
	});

	return filtered.sort((left, right) => compareAssetLibraryItems(left, right, sort));
};

export const mediaAssetIdFromURL = (value: string | undefined | null) => {
	const pathname = normalizedURLPath(value);
	if (!pathname) return "";
	const match = pathname.match(mediaContentURLPattern);
	if (!match?.[1]) return "";
	return decodeURIComponent(match[1]);
};

export const normalizedAssetURL = (value: string | undefined | null) => {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";
	try {
		const url = new URL(trimmed, "http://mediago.local");
		return `${url.pathname}${url.search}`.replace(
			/\/api\/media\/assets\//i,
			"/api/v1/media-assets/",
		);
	} catch {
		return trimmed;
	}
};

const mediaMatchKeys = (asset: MediaAsset) => {
	const keys = new Set<string>([`media:${asset.id}`]);
	const explicitID = mediaAssetIdFromURL(asset.url);
	if (explicitID) keys.add(`media:${explicitID}`);
	const normalizedURL = normalizedAssetURL(asset.url);
	if (normalizedURL) keys.add(`url:${normalizedURL}`);
	return [...keys];
};

const selectedAssetMatchKeys = (asset: SelectedGenerationAsset) => {
	const keys = new Set<string>();
	const explicitID = mediaAssetIdFromURL(asset.url);
	if (explicitID) keys.add(`media:${explicitID}`);
	const normalizedURL = normalizedAssetURL(asset.url);
	if (normalizedURL) keys.add(`url:${normalizedURL}`);
	return [...keys];
};

const normalizedURLPath = (value: string | undefined | null) => {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";
	try {
		return new URL(trimmed, "http://mediago.local").pathname;
	} catch {
		return trimmed;
	}
};

const normalizeAssetKind = (kind: string): AssetLibraryKind => {
	if (kind === "image" || kind === "video" || kind === "audio" || kind === "text") return kind;
	return "binary";
};

const uniqueResourceTypes = (types: AgentResourceType[]) => {
	const seen = new Set<AgentResourceType>();
	const unique: AgentResourceType[] = [];
	for (const type of types) {
		if (seen.has(type)) continue;
		seen.add(type);
		unique.push(type);
	}
	return unique;
};

const selectedAssetID = (asset: SelectedGenerationAsset) => `${asset.taskId}:${asset.assetIndex}`;

const compareAssetLibraryItems = (
	left: AssetLibraryItem,
	right: AssetLibraryItem,
	sort: AssetLibrarySort,
) => {
	if (sort === "nameAsc") return left.title.localeCompare(right.title, "zh-CN");
	if (sort === "sizeDesc") return right.sizeBytes - left.sizeBytes || fallbackCompare(left, right);
	if (sort === "createdDesc") return timestamp(right.createdAt) - timestamp(left.createdAt);
	return timestamp(right.updatedAt) - timestamp(left.updatedAt) || fallbackCompare(left, right);
};

const fallbackCompare = (left: AssetLibraryItem, right: AssetLibraryItem) =>
	left.title.localeCompare(right.title, "zh-CN") || left.key.localeCompare(right.key);

const timestamp = (value: string) => {
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : 0;
};
