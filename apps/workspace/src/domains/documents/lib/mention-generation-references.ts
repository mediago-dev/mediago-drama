import type { ResolvedMention } from "@/domains/documents/lib/mention-resolver";
import { mentionReferenceKey } from "@/domains/documents/lib/mention-resolver";
import { mentionDisplayText } from "@/domains/documents/lib/mention-suggestion";
import type { MediaAsset } from "@/domains/workspace/api/media";

export interface MentionPreviewReferences {
	assetMentionKeys: Record<string, string>;
	badges: Record<string, string>;
	references: MediaAsset[];
}

const mentionPreviewTimestamp = "1970-01-01T00:00:00.000Z";

export const buildMentionReferenceInputs = (mentions: ResolvedMention[]) => {
	const assetIds: string[] = [];
	const urls: string[] = [];
	const seenAssetIds = new Set<string>();
	const seenUrls = new Set<string>();

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		for (const image of mention.images) {
			if (image.mediaAssetId) {
				if (seenAssetIds.has(image.mediaAssetId)) continue;

				seenAssetIds.add(image.mediaAssetId);
				assetIds.push(image.mediaAssetId);
				continue;
			}

			if (!image.url || seenUrls.has(image.url)) continue;

			seenUrls.add(image.url);
			urls.push(image.url);
		}
	}

	return { assetIds, urls };
};

export const buildMentionPreviewReferences = (
	mentions: ResolvedMention[],
	mediaAssets: MediaAsset[],
): MentionPreviewReferences => {
	const seenReferenceIds = new Set<string>();
	const assetMentionKeys: Record<string, string> = {};
	const badges: Record<string, string> = {};
	const references: MediaAsset[] = [];

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		const mentionKey = mentionReferenceKey(mention.reference);
		const badge = `来自 ${mentionDisplayText(mention.reference.title)}`;

		for (const image of mention.images) {
			const matchedAsset = findMediaAssetForMentionImage(image, mediaAssets);
			const reference = matchedAsset ?? createMentionPreviewAsset(mention, image);
			if (!reference) continue;

			badges[reference.id] ??= badge;
			assetMentionKeys[reference.id] ??= mentionKey;
			if (seenReferenceIds.has(reference.id)) continue;

			seenReferenceIds.add(reference.id);
			references.push(reference);
		}
	}

	return { assetMentionKeys, badges, references };
};

export const uniqueResolvedMention = (
	mention: ResolvedMention,
	index: number,
	mentions: ResolvedMention[],
) =>
	mentions.findIndex(
		(item) => mentionReferenceKey(item.reference) === mentionReferenceKey(mention.reference),
	) === index;

export const extractDocumentImageAssets = (documentId: string, markdown: string): MediaAsset[] =>
	Array.from(markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g)).flatMap(
		(match, index) => {
			const url = match[1] ?? match[2] ?? "";
			if (!url) return [];

			return [
				{
					createdAt: mentionPreviewTimestamp,
					filename: `文档图片 ${index + 1}`,
					id: `document-image:${documentId}:${index}:${url}`,
					kind: "image" as const,
					mimeType: "image/*",
					sizeBytes: 0,
					sourceUrl: url,
					updatedAt: mentionPreviewTimestamp,
					url,
				},
			];
		},
	);

const findMediaAssetForMentionImage = (
	image: ResolvedMention["images"][number],
	mediaAssets: MediaAsset[],
) =>
	mediaAssets.find(
		(asset) =>
			asset.kind === "image" &&
			((image.mediaAssetId && asset.id === image.mediaAssetId) ||
				asset.url === image.url ||
				asset.sourceUrl === image.url),
	) ?? null;

const createMentionPreviewAsset = (
	mention: ResolvedMention,
	image: ResolvedMention["images"][number],
): MediaAsset | null => {
	if (!image.url) return null;

	return {
		createdAt: mentionPreviewTimestamp,
		filename: `来自 ${mentionDisplayText(mention.reference.title)}`,
		id: `mention-reference:${mentionReferenceKey(mention.reference)}:${image.mediaAssetId ?? image.url}`,
		kind: "image",
		mimeType: "image/*",
		sizeBytes: 0,
		sourceUrl: image.url,
		updatedAt: mentionPreviewTimestamp,
		url: image.url,
	};
};
