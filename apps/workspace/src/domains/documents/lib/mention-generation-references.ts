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
	assetMediaKeys: Record<string, string>;
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

export interface MentionReferenceAudio {
	mediaAssetId?: string;
	url: string;
}

export type ResolvedMentionWithSelectedAssets = ResolvedMention & {
	selectedAudios?: MentionReferenceAudio[];
};

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
): ResolvedMentionWithSelectedAssets => {
	const mention = resolveMentionPayload(reference, allDocuments, allAssets);
	if (
		mention.status !== "ok" ||
		mention.reference.kind === "asset" ||
		selectedAssets.length === 0
	) {
		return mention;
	}

	const selectedImages = selectedImagesForMention(mention.reference, selectedAssets);
	const selectedAudios = selectedAudiosForMention(mention.reference, selectedAssets);
	if (selectedImages.length === 0 && selectedAudios.length === 0) return mention;

	return {
		...mention,
		...(selectedImages.length > 0
			? { images: uniqueMentionImages([...mention.images, ...selectedImages]) }
			: {}),
		...(selectedAudios.length > 0 ? { selectedAudios: uniqueMentionAudios(selectedAudios) } : {}),
	};
};

export const buildMentionReferenceInputs = (
	mentions: readonly ResolvedMentionWithSelectedAssets[],
	options: { includeSelectedAudios?: boolean } = {},
) => {
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

		if (!options.includeSelectedAudios) continue;

		for (const audio of mention.selectedAudios ?? []) {
			const binding = mentionReferenceBinding(mention, audio);
			const bindingKey = binding ? mentionReferenceBindingKey(binding) : "";
			if (binding && bindingKey && !seenBindings.has(bindingKey)) {
				seenBindings.add(bindingKey);
				bindings.push(binding);
			}

			if (audio.mediaAssetId) {
				if (seenAssetIds.has(audio.mediaAssetId)) continue;

				seenAssetIds.add(audio.mediaAssetId);
				assetIds.push(audio.mediaAssetId);
				continue;
			}

			if (!audio.url || seenUrls.has(audio.url)) continue;

			seenUrls.add(audio.url);
			urls.push(audio.url);
		}
	}

	return { assetIds, bindings, urls };
};

export const buildMentionPreviewReferences = (
	mentions: readonly ResolvedMentionWithSelectedAssets[],
	mediaAssets: MediaAsset[],
): MentionPreviewReferences => {
	const seenReferenceIds = new Set<string>();
	const assetMediaKeys: Record<string, string> = {};
	const assetMentionKeys: Record<string, string> = {};
	const badges: Record<string, string> = {};
	const references: MediaAsset[] = [];

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		const mentionKey = mentionReferenceKey(mention.reference);
		const badge = `来自 ${mentionDisplayText(mention.reference.title)}`;

		for (const image of mention.images) {
			const matchedAsset = findMediaAssetForMentionMedia(image, mediaAssets, "image");
			const reference = matchedAsset ?? createMentionPreviewAsset(mention, image, "image");
			addMentionPreviewReference(reference, {
				assetMediaKeys,
				assetMentionKeys,
				badge,
				badges,
				mediaKey: mentionReferenceMediaKey("image", image),
				mentionKey,
				references,
				seenReferenceIds,
			});
		}

		for (const audio of mention.selectedAudios ?? []) {
			const matchedAsset = findMediaAssetForMentionMedia(audio, mediaAssets, "audio");
			const reference = matchedAsset ?? createMentionPreviewAsset(mention, audio, "audio");
			addMentionPreviewReference(reference, {
				assetMediaKeys,
				assetMentionKeys,
				badge,
				badges,
				mediaKey: mentionReferenceMediaKey("audio", audio),
				mentionKey,
				references,
				seenReferenceIds,
			});
		}
	}

	return { assetMediaKeys, assetMentionKeys, badges, references };
};

export const filterMentionReferenceMedia = (
	mention: ResolvedMentionWithSelectedAssets,
	removedMediaKeys: ReadonlySet<string>,
): ResolvedMentionWithSelectedAssets => {
	if (mention.status !== "ok" || removedMediaKeys.size === 0) return mention;

	const images = mention.images.filter(
		(image) => !removedMediaKeys.has(mentionReferenceMediaKey("image", image)),
	);
	const selectedAudios = mention.selectedAudios?.filter(
		(audio) => !removedMediaKeys.has(mentionReferenceMediaKey("audio", audio)),
	);

	if (
		images.length === mention.images.length &&
		selectedAudios?.length === mention.selectedAudios?.length
	) {
		return mention;
	}

	return {
		...mention,
		images,
		...(selectedAudios ? { selectedAudios } : {}),
	};
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

const findMediaAssetForMentionMedia = (
	media: ResolvedMention["images"][number] | MentionReferenceAudio,
	mediaAssets: MediaAsset[],
	kind: MediaAsset["kind"],
) =>
	mediaAssets.find(
		(asset) =>
			asset.kind === kind &&
			((media.mediaAssetId && asset.id === media.mediaAssetId) ||
				asset.url === media.url ||
				asset.sourceUrl === media.url),
	) ?? null;

const createMentionPreviewAsset = (
	mention: ResolvedMention,
	media: ResolvedMention["images"][number] | MentionReferenceAudio,
	kind: MediaAsset["kind"],
): MediaAsset | null => {
	if (!media.url) return null;

	return {
		createdAt: mentionPreviewTimestamp,
		filename: `来自 ${mentionDisplayText(mention.reference.title)}`,
		id: `mention-reference:${mentionReferenceKey(mention.reference)}:${kind}:${media.mediaAssetId ?? media.url}`,
		kind,
		mimeType: kind === "audio" ? "audio/*" : "image/*",
		sizeBytes: 0,
		sourceUrl: media.url,
		updatedAt: mentionPreviewTimestamp,
		url: media.url,
	};
};

const addMentionPreviewReference = (
	reference: MediaAsset | null,
	context: {
		assetMediaKeys: Record<string, string>;
		assetMentionKeys: Record<string, string>;
		badge: string;
		badges: Record<string, string>;
		mediaKey: string;
		mentionKey: string;
		references: MediaAsset[];
		seenReferenceIds: Set<string>;
	},
) => {
	if (!reference) return;

	context.assetMediaKeys[reference.id] ??= context.mediaKey;
	context.badges[reference.id] ??= context.badge;
	context.assetMentionKeys[reference.id] ??= context.mentionKey;
	if (context.seenReferenceIds.has(reference.id)) return;

	context.seenReferenceIds.add(reference.id);
	context.references.push(reference);
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

		const url = selectedGenerationAssetSource(asset);
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

const selectedAudiosForMention = (
	reference: AgentReference,
	selectedAssets: SelectedGenerationAsset[],
): MentionReferenceAudio[] => {
	const resourceType = selectedResourceTypeForMention(reference);
	if (!resourceType) return [];

	return selectedAssets.flatMap((asset) => {
		if (asset.kind !== "audio" || asset.resourceType !== resourceType) return [];
		if (!selectedAssetMatchesMention(asset, reference)) return [];

		const url = selectedGenerationAssetSource(asset);
		if (!url) return [];

		const mediaAssetId = asset.mediaAssetId ?? mediaAssetIdFromGeneratedSource(url) ?? undefined;
		if (!mediaAssetId) return [];

		return [
			{
				mediaAssetId,
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

const selectedGenerationAssetSource = (asset: SelectedGenerationAsset) =>
	generationAssetSource({
		base64: asset.base64,
		kind: asset.kind,
		mimeType: asset.mimeType,
		url: asset.url,
	}) || selectedGenerationAssetMediaURL(asset);

const selectedGenerationAssetMediaURL = (asset: SelectedGenerationAsset) =>
	asset.mediaAssetId
		? `/api/v1/media-assets/${encodeURIComponent(asset.mediaAssetId)}/content`
		: "";

const mentionReferenceMediaKey = (
	kind: "audio" | "image",
	media: ResolvedMention["images"][number] | MentionReferenceAudio,
) => {
	const mediaAssetId = media.mediaAssetId?.trim();
	if (mediaAssetId) return `${kind}:media:${mediaAssetId}`;

	return `${kind}:url:${media.url.trim()}`;
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

const uniqueMentionAudios = (audios: MentionReferenceAudio[]) => {
	const seen = new Set<string>();
	const uniqueAudios: MentionReferenceAudio[] = [];

	for (const audio of audios) {
		const keys = mentionAudioKeys(audio);
		if (keys.some((key) => seen.has(key))) continue;

		for (const key of keys) seen.add(key);
		uniqueAudios.push(audio);
	}

	return uniqueAudios;
};

const mentionAudioKeys = (audio: MentionReferenceAudio) =>
	[
		audio.mediaAssetId ? `media:${audio.mediaAssetId}` : "",
		mediaAssetIdFromGeneratedSource(audio.url)
			? `media:${mediaAssetIdFromGeneratedSource(audio.url)}`
			: "",
		audio.url ? `url:${audio.url}` : "",
	].filter(Boolean);

const mentionReferenceBinding = (
	mention: ResolvedMention,
	asset: ResolvedMention["images"][number] | MentionReferenceAudio,
): MentionReferenceBinding | null => {
	const assetId = asset.mediaAssetId ?? mediaAssetIdFromGeneratedSource(asset.url) ?? "";
	const url = assetId ? "" : asset.url;
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
