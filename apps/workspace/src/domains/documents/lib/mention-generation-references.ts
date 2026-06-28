import type { AgentReference } from "@/domains/agent/api/agent";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type { MarkdownDocument } from "@/domains/documents/stores";
import type { ResolvedMention } from "@/domains/documents/lib/mention-resolver";
import {
	mediaAssetIdFromGeneratedSource,
	mentionReferenceKey,
	resolveMentionPayload,
} from "@/domains/documents/lib/mention-resolver";
import { mentionDisplayText } from "@/domains/documents/lib/mention-suggestion";
import type { MediaAsset } from "@/domains/workspace/api/media";

export interface MentionPreviewReferences {
	assetMentionKeys: Record<string, string>;
	badges: Record<string, string>;
	references: MediaAsset[];
}

export interface MentionReferenceBinding {
	assetId?: string;
	blockId?: string;
	documentId?: string;
	kind?: string;
	url?: string;
}

const mentionPreviewTimestamp = "1970-01-01T00:00:00.000Z";
const selectedGenerationResourceTypes = new Set<SelectedGenerationAsset["resourceType"]>([
	"character",
	"scene",
	"storyboard",
	"prop",
]);

export const resolveMentionPayloadWithSelectedAssets = (
	reference: AgentReference,
	allDocuments: MarkdownDocument[],
	allAssets: ProjectAsset[] = [],
	selectedAssets: SelectedGenerationAsset[] = [],
): ResolvedMention => {
	const mention = resolveMentionPayload(reference, allDocuments, allAssets);
	if (
		mention.status !== "ok" ||
		mention.reference.kind === "asset" ||
		selectedAssets.length === 0
	) {
		return mention;
	}

	const selectedImages = selectedImagesForMention(mention.reference, selectedAssets);
	if (selectedImages.length === 0) return mention;

	return {
		...mention,
		images: uniqueMentionImages([...mention.images, ...selectedImages]),
	};
};

export const buildMentionReferenceInputs = (mentions: ResolvedMention[]) => {
	const assetIds: string[] = [];
	const bindings: MentionReferenceBinding[] = [];
	const urls: string[] = [];
	const seenAssetIds = new Set<string>();
	const seenBindings = new Set<string>();
	const seenUrls = new Set<string>();

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		for (const image of mention.images) {
			const binding = mentionReferenceBinding(mention, image);
			const bindingKey = binding ? mentionReferenceBindingKey(binding) : "";
			if (binding && bindingKey && !seenBindings.has(bindingKey)) {
				seenBindings.add(bindingKey);
				bindings.push(binding);
			}

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

	return { assetIds, bindings, urls };
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

const selectedImagesForMention = (
	reference: AgentReference,
	selectedAssets: SelectedGenerationAsset[],
): ResolvedMention["images"] => {
	const resourceType = selectedResourceTypeForMention(reference);
	if (!resourceType) return [];

	return selectedAssets.flatMap((asset) => {
		if (asset.kind !== "image" || asset.resourceType !== resourceType) return [];
		if (!selectedAssetMatchesMention(asset, reference)) return [];

		const url = generationAssetSource({
			base64: asset.base64,
			kind: asset.kind,
			mimeType: asset.mimeType,
			url: asset.url,
		});
		if (!url) return [];

		const mediaAssetId = asset.mediaAssetId ?? mediaAssetIdFromGeneratedSource(url) ?? undefined;
		return [
			{
				...(mediaAssetId ? { mediaAssetId } : {}),
				url,
			},
		];
	});
};

const selectedResourceTypeForMention = (
	reference: AgentReference,
): SelectedGenerationAsset["resourceType"] | null => {
	const category = reference.category;
	return category &&
		selectedGenerationResourceTypes.has(category as SelectedGenerationAsset["resourceType"])
		? (category as SelectedGenerationAsset["resourceType"])
		: null;
};

const selectedAssetMatchesMention = (asset: SelectedGenerationAsset, reference: AgentReference) => {
	const documentId = reference.documentId.trim();
	const sourceDocumentId = asset.sourceDocumentId?.trim() ?? "";
	if (documentId && sourceDocumentId && sourceDocumentId !== documentId) return false;

	const mentionBlockId = reference.kind === "section" ? (reference.blockId?.trim() ?? "") : "";
	const resourceId = asset.resourceId?.trim() ?? "";
	if (mentionBlockId) {
		if (resourceId) return resourceId === mentionBlockId;
		return sourceDocumentId === documentId;
	}

	return sourceDocumentId === documentId || (!sourceDocumentId && !resourceId);
};

const uniqueMentionImages = (images: ResolvedMention["images"]) => {
	const seen = new Set<string>();
	const uniqueImages: ResolvedMention["images"] = [];

	for (const image of images) {
		const keys = mentionImageKeys(image);
		if (keys.some((key) => seen.has(key))) continue;

		for (const key of keys) seen.add(key);
		uniqueImages.push(image);
	}

	return uniqueImages;
};

const mentionImageKeys = (image: ResolvedMention["images"][number]) =>
	[
		image.mediaAssetId ? `media:${image.mediaAssetId}` : "",
		mediaAssetIdFromGeneratedSource(image.url)
			? `media:${mediaAssetIdFromGeneratedSource(image.url)}`
			: "",
		image.url ? `url:${image.url}` : "",
	].filter(Boolean);

const mentionReferenceBinding = (
	mention: ResolvedMention,
	image: ResolvedMention["images"][number],
): MentionReferenceBinding | null => {
	const assetId = image.mediaAssetId ?? mediaAssetIdFromGeneratedSource(image.url) ?? "";
	const url = assetId ? "" : image.url;
	if (!assetId && !url) return null;

	return {
		...(assetId ? { assetId } : {}),
		...(mention.reference.kind === "section" && mention.reference.blockId
			? { blockId: mention.reference.blockId }
			: {}),
		documentId: mention.reference.documentId,
		kind: mention.reference.kind,
		...(url ? { url } : {}),
	};
};

const mentionReferenceBindingKey = (binding: MentionReferenceBinding) =>
	[
		binding.kind ?? "",
		binding.documentId ?? "",
		binding.blockId ?? "",
		binding.assetId ? `asset:${binding.assetId}` : "",
		binding.url ? `url:${binding.url}` : "",
	].join("\x00");
