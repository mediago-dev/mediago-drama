import type { AgentReference } from "@/domains/agent/api/agent";
import { documentCategoryDescriptors } from "@/domains/documents/lib/categories";
import {
	legacySourceMaterialDocumentCategory,
	referenceDocumentCategory,
} from "@/domains/documents/stores";
import {
	createSectionBlockId,
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
	listDocumentSections,
	normalizeHeadingText,
	stripSectionIdCommentLines,
} from "@/domains/documents/lib/sections";
import type { DocumentCategory, MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

export interface ResolvedMentionImage {
	mediaAssetId?: string;
	url: string;
}

export interface ResolvedMention {
	images: ResolvedMentionImage[];
	reference: AgentReference;
	status: "ok" | "missing";
	text: string;
}

const mentionLinkPattern = /@\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)/g;
const markdownImageLinePattern = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/;
const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/;
const placeholderImageAltPrefix = "mediago-drama-section-image-pending:";
const legacyPlaceholderImageAltPrefix = "media-cli-section-image-pending:";
const placeholderImageAltPrefixes = [placeholderImageAltPrefix, legacyPlaceholderImageAltPrefix];
const documentCategories = new Set<DocumentCategory>(
	documentCategoryDescriptors.map((descriptor) => descriptor.key),
);

export const parseMentionsFromMarkdown = (markdown: string): AgentReference[] => {
	const references: AgentReference[] = [];
	const seen = new Set<string>();

	for (const match of markdown.matchAll(mentionLinkPattern)) {
		const title = unescapeMentionLabel(match[1] ?? "");
		const href = match[2] ?? match[3] ?? "";
		const reference = parseMentionHref(href, title);
		if (!reference) continue;

		const key = mentionReferenceKey(reference);
		if (seen.has(key)) continue;

		seen.add(key);
		references.push(reference);
	}

	return references;
};

export const resolveMentionPayload = (
	reference: AgentReference,
	allDocuments: MarkdownDocument[],
	allAssets: ProjectAsset[] = [],
): ResolvedMention => {
	if (reference.kind === "asset") {
		const assetID = reference.assetId ?? reference.documentId;
		const asset = allAssets.find((item) => item.id === assetID);
		if (!asset) {
			return {
				images: [],
				reference,
				status: "missing",
				text: "",
			};
		}

		return {
			images: asset.kind === "image" ? [{ url: asset.url }] : [],
			reference: {
				...reference,
				assetId: asset.id,
				assetKind: asset.kind,
				category: "reference",
				documentId: asset.id,
				mimeType: asset.mimeType,
				title: reference.title || asset.filename,
				url: asset.url,
			},
			status: "ok",
			text: asset.kind === "text" ? `文件：${asset.filename}\nMIME：${asset.mimeType}` : "",
		};
	}

	const document = allDocuments.find((item) => item.id === reference.documentId);
	if (!document) {
		return {
			images: [],
			reference,
			status: "missing",
			text: "",
		};
	}

	const resolvedReference = normalizeSingleSectionDocumentReference(reference, document);
	const markdown =
		resolvedReference.kind === "section" && resolvedReference.blockId
			? sectionMarkdownByBlockId(document, resolvedReference.blockId)
			: document.content;

	if (markdown == null) {
		return {
			images: [],
			reference: resolvedReference,
			status: "missing",
			text: "",
		};
	}

	const images = extractMentionImages(markdown);

	return {
		images,
		reference: {
			...resolvedReference,
			category: resolvedReference.category ?? document.category,
		},
		status: "ok",
		text: stripSectionIdCommentLines(stripImageLines(markdown)).trim(),
	};
};

export const parseMentionHref = (href: string, title: string): AgentReference | null => {
	const assetMatch = /^asset:\/\/([^/?#]+)(?:\?([^#]*))?(?:#.*)?$/.exec(href);
	if (assetMatch) {
		const assetId = safeDecodeURIComponent(assetMatch[1] ?? "");
		if (!assetId) return null;

		const params = new URLSearchParams(assetMatch[2] ?? "");
		return {
			kind: "asset",
			documentId: assetId,
			assetId,
			assetKind: params.get("kind") ?? undefined,
			category: "reference",
			mimeType: params.get("mimeType") ?? undefined,
			title,
			url: params.get("url") ?? undefined,
		};
	}

	const match = /^mention:\/\/([^/?#]+)(?:\/([^?#]+))?(?:\?([^#]*))?(?:#.*)?$/.exec(href);
	if (!match) return null;

	const documentId = safeDecodeURIComponent(match[1] ?? "");
	const blockId = match[2] ? safeDecodeURIComponent(match[2]) : undefined;
	if (!documentId) return null;

	const params = new URLSearchParams(match[3] ?? "");
	const kind = params.get("kind") === "section" || blockId ? "section" : "document";
	const category = normalizeCategory(params.get("category"));

	return {
		kind,
		documentId,
		...(kind === "section" && blockId ? { blockId } : {}),
		title,
		...(category ? { category } : {}),
	};
};

export const mentionMarkdownFromReference = (reference: AgentReference) => {
	const label = escapeMentionLabel(reference.title);
	return `@[${label}](${mentionHrefFromReference(reference)})`;
};

export const mentionHrefFromReference = (reference: AgentReference) => {
	if (reference.kind === "asset") {
		const params = new URLSearchParams();
		if (reference.assetKind) params.set("kind", reference.assetKind);
		if (reference.mimeType) params.set("mimeType", reference.mimeType);
		if (reference.url) params.set("url", reference.url);
		const query = params.toString();
		return `asset://${encodeURIComponent(reference.assetId ?? reference.documentId)}${query ? `?${query}` : ""}`;
	}

	const blockPath =
		reference.kind === "section" && reference.blockId
			? `/${encodeURIComponent(reference.blockId)}`
			: "";

	return `mention://${encodeURIComponent(reference.documentId)}${blockPath}`;
};

export const mentionReferenceKey = (reference: AgentReference) =>
	reference.kind === "asset"
		? `asset:${reference.assetId ?? reference.documentId}`
		: `${reference.documentId}:${reference.kind === "section" ? (reference.blockId ?? "") : ""}`;

export const mediaAssetIdFromGeneratedSource = (source: string) => {
	const match = source.match(
		/\/api(?:\/v1)?\/(?:projects\/[^/]+\/)?(?:media\/assets|media-assets)\/([^/?#]+)\/content/i,
	);
	if (!match?.[1]) return null;

	return decodeURIComponent(match[1]);
};

const sectionMarkdownByBlockId = (document: MarkdownDocument, blockId: string) => {
	const lines = document.content.split("\n");
	let headingIndex = findMarkdownSectionHeadingLine(lines, {
		blockId,
		headingLevel: 0,
		headingOccurrence: 0,
		headingText: "",
	});
	if (headingIndex < 0) headingIndex = findFallbackSectionHeadingLine(document, lines, blockId);
	if (headingIndex < 0) return null;

	const headingMatch = /^(#{1,6})\s+/.exec(lines[headingIndex]);
	const headingLevel = headingMatch?.[1]?.length ?? 1;

	return lines
		.slice(headingIndex, findMarkdownSectionEndLine(lines, headingIndex, headingLevel))
		.join("\n");
};

const findFallbackSectionHeadingLine = (
	document: MarkdownDocument,
	lines: string[],
	blockId: string,
) => {
	const occurrenceByHeading = new Map<string, number>();

	for (let index = 0; index < lines.length; index += 1) {
		const match = headingLinePattern.exec(lines[index]);
		if (!match) continue;

		const level = match[1].length;
		const title = normalizeHeadingText(match[2]);
		const occurrenceKey = `${level}|${title}`;
		const occurrence = (occurrenceByHeading.get(occurrenceKey) ?? 0) + 1;
		occurrenceByHeading.set(occurrenceKey, occurrence);

		if (createSectionBlockId(document.id, level, occurrence, title) === blockId) return index;
	}

	return -1;
};

const normalizeSingleSectionDocumentReference = (
	reference: AgentReference,
	document: MarkdownDocument,
): AgentReference => {
	if (reference.kind !== "document") return reference;

	const sections = listDocumentSections(document);
	if (sections.length !== 1) return reference;

	const [section] = sections;
	if (!section) return reference;

	return {
		...reference,
		blockId: section.blockId,
		category: reference.category ?? document.category,
		kind: "section",
		title: reference.title || section.title,
	};
};

const extractMentionImages = (markdown: string): ResolvedMentionImage[] => {
	const images: ResolvedMentionImage[] = [];
	const seen = new Set<string>();

	for (const line of markdown.split("\n")) {
		const image = markdownImageFromLine(line.trim());
		if (!image || isPlaceholderImage(image)) continue;

		const mediaAssetId = mediaAssetIdFromGeneratedSource(image.url) ?? undefined;
		const key = mediaAssetId ?? image.url;
		if (seen.has(key)) continue;

		seen.add(key);
		images.push({
			url: image.url,
			...(mediaAssetId ? { mediaAssetId } : {}),
		});
	}

	return images;
};

const stripImageLines = (markdown: string) =>
	markdown
		.split("\n")
		.filter((line) => !markdownImageFromLine(line.trim()))
		.join("\n");

const markdownImageFromLine = (line: string) => {
	const match = markdownImageLinePattern.exec(line);
	if (!match) return null;

	return {
		alt: match[1],
		url: match[2] ?? match[3] ?? "",
	};
};

const isPlaceholderImage = (image: { alt: string; url: string }) =>
	placeholderImageAltPrefixes.some((prefix) => image.alt.startsWith(prefix)) ||
	image.url.startsWith("data:image/svg+xml");

const normalizeCategory = (value: string | null): DocumentCategory | undefined => {
	if (value === legacySourceMaterialDocumentCategory) return referenceDocumentCategory;
	return value && documentCategories.has(value as DocumentCategory)
		? (value as DocumentCategory)
		: undefined;
};

const escapeMentionLabel = (value: string) => value.replace(/[[\]\\]/g, "\\$&");

const unescapeMentionLabel = (value: string) => value.replace(/\\([\\[\]])/g, "$1");

const safeDecodeURIComponent = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};
