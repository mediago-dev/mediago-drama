import type { ResolvedMention } from "@/domains/documents/lib/mention-resolver";
import { mentionReferenceKey } from "@/domains/documents/lib/mention-resolver";
import { mentionDisplayText } from "@/domains/documents/lib/mention-suggestion";
import type { MediaAsset } from "@/domains/workspace/api/media";

export interface MentionPreviewReferences {
	assetMentionKeys: Record<string, string>;
	badges: Record<string, string>;
	references: MediaAsset[];
}

export interface DocumentSectionImageReference {
	asset: MediaAsset;
	imageLabel: string;
	sectionTitle: string;
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

export const extractDocumentSectionImageReferences = (
	documentId: string,
	markdown: string,
): DocumentSectionImageReference[] => {
	const references: DocumentSectionImageReference[] = [];
	const lines = markdown.split("\n");
	let currentSectionTitle = "";
	let currentSectionIndex = 0;
	let currentSectionSources = new Set<string>();
	let imageIndex = 0;

	for (const line of lines) {
		const heading = markdownHeadingFromLine(line);
		if (heading) {
			currentSectionTitle = heading;
			currentSectionIndex += 1;
			currentSectionSources = new Set<string>();
			continue;
		}

		if (!currentSectionTitle) continue;

		const image = markdownImageFromLine(line.trim());
		if (
			!image ||
			isPendingSectionImage(image.alt, image.source) ||
			currentSectionSources.has(image.source)
		) {
			continue;
		}

		currentSectionSources.add(image.source);
		imageIndex += 1;
		references.push({
			asset: {
				createdAt: mentionPreviewTimestamp,
				filename: `${currentSectionTitle} · 图片 ${imageIndex}`,
				id: `document-section-image:${documentId}:${currentSectionIndex}:${imageIndex}:${image.source}`,
				kind: "image",
				mimeType: "image/*",
				sizeBytes: 0,
				sourceUrl: image.source,
				updatedAt: mentionPreviewTimestamp,
				url: image.source,
			},
			imageLabel: image.alt.trim() || `图片 ${imageIndex}`,
			sectionTitle: currentSectionTitle,
		});
	}

	return references;
};

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

const markdownHeadingFromLine = (line: string) => {
	const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
	if (!match?.[2]) return "";

	return match[2].trim() || "未命名节点";
};

const markdownImageFromLine = (line: string) => {
	const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(line);
	if (!match) return null;

	return {
		alt: match[1] ?? "",
		source: match[2] ?? match[3] ?? "",
	};
};

const isPendingSectionImage = (alt: string, source: string) =>
	["mediago-drama-section-image-pending:", "media-cli-section-image-pending:"].some((prefix) =>
		alt.startsWith(prefix),
	) ||
	Boolean(source.startsWith("mediago-drama-section-image-pending:")) ||
	Boolean(source.startsWith("media-cli-section-image-pending:")) ||
	(alt === "正在生成图片" && source.startsWith("data:image/svg+xml;base64,"));
