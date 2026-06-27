import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import type { DocumentCategory, MarkdownDocument } from "@/domains/documents/stores";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { AgentResourceType } from "@/domains/workspace/lib/workbench-route";

export type AssetLibraryKind = "image" | "video" | "audio" | "text" | "binary";
export type AssetLibrarySource = "media" | "selected";
export type AssetLibraryResourceType = AgentResourceType | "screenplay" | "reference";
export type AssetLibraryKindFilter = "all" | AssetLibraryKind;
export type AssetLibrarySourceFilter = "all" | AssetLibrarySource;
export type AssetLibraryResourceFilter = "all" | AssetLibraryResourceType;
export type AssetLibrarySort = "updatedDesc" | "createdDesc" | "nameAsc" | "sizeDesc";

export interface AssetLibraryItem {
	createdAt: string;
	id: string;
	key: string;
	kind: AssetLibraryKind;
	mediaAsset?: MediaAsset;
	mimeType: string;
	selectedAssets: SelectedGenerationAsset[];
	selectedResourceTypes: AssetLibraryResourceType[];
	sizeBytes: number;
	sourceType: AssetLibrarySource;
	title: string;
	updatedAt: string;
	url: string;
	downloadPath?: string;
}

export interface BuildAssetLibraryItemsInput {
	documents?: MarkdownDocument[];
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
	documents = [],
	mediaAssets = [],
	selectedAssets = [],
}: BuildAssetLibraryItemsInput): AssetLibraryItem[] => {
	const items: AssetLibraryItem[] = [];
	const mediaItemByMatchKey = new Map<string, AssetLibraryItem>();
	const selectedAssetIDs = new Set<string>();
	const documentResourceTypesByID = new Map(
		documents.flatMap((document) => {
			const resourceType = resourceTypeForDocumentCategory(document.category);
			return resourceType ? [[document.id, resourceType] as const] : [];
		}),
	);

	for (const asset of mediaAssets) {
		const item: AssetLibraryItem = {
			createdAt: asset.createdAt,
			id: asset.id,
			key: `media:${asset.id}`,
			kind: asset.kind,
			mediaAsset: asset,
			mimeType: asset.mimeType,
			selectedAssets: [],
			selectedResourceTypes: mediaAssetDocumentResourceTypes(asset, documentResourceTypesByID),
			sizeBytes: asset.sizeBytes,
			sourceType: "media",
			title: asset.filename || "untitled",
			updatedAt: asset.updatedAt,
			url: asset.url,
			downloadPath: asset.downloadPath,
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
					asset.resourceType as AssetLibraryResourceType,
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
			selectedResourceTypes: [asset.resourceType as AssetLibraryResourceType],
			sizeBytes: 0,
			sourceType: "selected",
			title: asset.title?.trim() || "untitled",
			updatedAt: asset.updatedAt ?? asset.createdAt ?? "",
			url: asset.url ?? "",
			downloadPath: asset.downloadPath,
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
		if (source !== "all" && !assetLibraryItemMatchesSource(item, source)) return false;
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

const assetLibraryItemMatchesSource = (
	item: AssetLibraryItem,
	source: AssetLibrarySourceFilter,
) => {
	if (source === "all") return true;
	if (source === "selected") return item.selectedAssets.length > 0;
	return item.sourceType === source;
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
	if (asset.mediaAssetId) keys.add(`media:${asset.mediaAssetId}`);
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

const resourceTypeForDocumentCategory = (
	category: DocumentCategory | undefined,
): AssetLibraryResourceType | null => {
	if (
		category === "screenplay" ||
		category === "character" ||
		category === "scene" ||
		category === "prop" ||
		category === "storyboard" ||
		category === "reference"
	) {
		return category;
	}
	return null;
};

const mediaAssetDocumentResourceTypes = (
	asset: MediaAsset,
	resourceTypeByDocumentID: Map<string, AssetLibraryResourceType>,
) => {
	const types: AssetLibraryResourceType[] = [];
	for (const documentID of mediaAssetCandidateDocumentIDs(asset)) {
		const type = resourceTypeByDocumentID.get(documentID);
		if (type) types.push(type);
	}
	return uniqueResourceTypes(types);
};

const mediaAssetCandidateDocumentIDs = (asset: MediaAsset) => {
	const ids = new Set<string>();
	for (const value of [asset.sectionId, asset.conversationId]) {
		for (const id of documentIDsFromGenerationScope(value)) ids.add(id);
	}
	return [...ids];
};

const documentIDsFromGenerationScope = (value: string | undefined | null) => {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return [];

	const parts = trimmed.split(":").filter(Boolean).map(decodeScopePart);
	const ids = new Set<string>();
	if (parts.length > 0) ids.add(parts[0]);
	const sectionIndex = parts.indexOf("section");
	if (sectionIndex >= 0 && parts[sectionIndex + 1]) ids.add(parts[sectionIndex + 1]);
	return [...ids];
};

const decodeScopePart = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const uniqueResourceTypes = (types: AssetLibraryResourceType[]) => {
	const seen = new Set<AssetLibraryResourceType>();
	const unique: AssetLibraryResourceType[] = [];
	for (const type of types) {
		if (seen.has(type)) continue;
		seen.add(type);
		unique.push(type);
	}
	return unique;
};

const selectedAssetID = (asset: SelectedGenerationAsset) => asset.id;

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
