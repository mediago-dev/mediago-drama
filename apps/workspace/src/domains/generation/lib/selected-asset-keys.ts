import type { GenerationKind, SelectedGenerationAsset } from "@/domains/generation/api/generation";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { generationAssetSelectionKey } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export const selectedGenerationAssetSelectionKey = (asset: SelectedGenerationAsset) =>
	generationAssetSelectionKey({
		base64: asset.base64,
		kind: asset.kind,
		mimeType: asset.mimeType,
		url: asset.url,
	});

export const selectedGenerationAssetKeysForSection = (
	assets: readonly SelectedGenerationAsset[],
	section: Pick<MarkdownSectionContext, "blockId" | "documentId">,
	kind: GenerationKind,
) => {
	const documentId = section.documentId.trim();
	const sectionId = section.blockId.trim();
	if (!documentId || !sectionId) return [];

	return assets
		.filter((asset) => selectedGenerationAssetMatchesSection(asset, documentId, sectionId, kind))
		.map(selectedGenerationAssetSelectionKey)
		.filter((key): key is string => Boolean(key));
};

const selectedGenerationAssetMatchesSection = (
	asset: SelectedGenerationAsset,
	documentId: string,
	sectionId: string,
	kind: GenerationKind,
) => {
	if (asset.kind !== kind || asset.resourceId?.trim() !== sectionId) return false;

	const sourceDocumentId = asset.sourceDocumentId?.trim();
	return !sourceDocumentId || sourceDocumentId === documentId;
};
