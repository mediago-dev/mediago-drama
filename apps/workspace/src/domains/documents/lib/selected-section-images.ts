export interface SelectedSectionImageAssetLike {
	assetIndex?: number;
	base64?: string;
	id: string;
	kind?: string;
	mimeType?: string;
	resourceId?: string;
	resourceTitle?: string;
	sortOrder?: number;
	sourceDocumentId?: string;
	title?: string;
	updatedAt?: string;
	url?: string;
}

export const selectedSectionImageAssetSource = (asset: SelectedSectionImageAssetLike) => {
	const url = asset.url?.trim();
	if (url) return url;

	const base64 = asset.base64?.trim();
	if (!base64) return "";
	if (base64.startsWith("data:")) return base64;

	return `data:${asset.mimeType?.trim() || "image/png"};base64,${base64}`;
};

export const selectedSectionImageAssetKey = (asset: SelectedSectionImageAssetLike) => {
	const source = selectedSectionImageAssetSource(asset);
	return source ? `image:${source}` : "";
};

export const selectedSectionImageAssetsForDocument = <T extends SelectedSectionImageAssetLike>(
	assets: readonly T[],
	documentId: string,
) => {
	const normalizedDocumentId = documentId.trim();
	if (!normalizedDocumentId) return [];

	return sortSelectedSectionImageAssets(
		assets.filter(
			(asset) =>
				asset.kind === "image" &&
				Boolean(asset.resourceId?.trim()) &&
				selectedAssetMatchesDocument(asset, normalizedDocumentId) &&
				Boolean(selectedSectionImageAssetSource(asset)),
		),
	);
};

export const selectedSectionImageAssetsForSection = <T extends SelectedSectionImageAssetLike>(
	assets: readonly T[],
	documentId: string,
	sectionId: string,
) => {
	const normalizedSectionId = sectionId.trim();
	if (!normalizedSectionId) return [];

	return selectedSectionImageAssetsForDocument(assets, documentId).filter(
		(asset) => asset.resourceId?.trim() === normalizedSectionId,
	);
};

const selectedAssetMatchesDocument = (asset: SelectedSectionImageAssetLike, documentId: string) => {
	const sourceDocumentId = asset.sourceDocumentId?.trim();
	return !sourceDocumentId || sourceDocumentId === documentId;
};

const sortSelectedSectionImageAssets = <T extends SelectedSectionImageAssetLike>(
	assets: readonly T[],
) =>
	[...assets].sort((first, second) => {
		const sortOrderDelta = (first.sortOrder ?? 0) - (second.sortOrder ?? 0);
		if (sortOrderDelta !== 0) return sortOrderDelta;

		const assetIndexDelta = (first.assetIndex ?? 0) - (second.assetIndex ?? 0);
		if (assetIndexDelta !== 0) return assetIndexDelta;

		return first.id.localeCompare(second.id);
	});
