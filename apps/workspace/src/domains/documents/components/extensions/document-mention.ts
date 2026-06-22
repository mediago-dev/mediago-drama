import Mention from "@tiptap/extension-mention";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { AgentReference } from "@/domains/agent/api/agent";
import {
	createMentionSuggestion,
	documentCategory,
	fallbackMentionCategory,
	mentionDisplayText,
	renderDataAttribute,
	stringAttribute,
} from "@/domains/documents/lib/mention-suggestion";
import {
	mentionMarkdownFromReference,
	parseMentionHref,
} from "@/domains/documents/lib/mention-resolver";
import { useDocumentsStore } from "@/domains/documents/stores";
import "@/styles/tiptap-mention.css";

const mentionLinkPattern = /^@\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)/;

export const DocumentMention = Mention.extend({
	name: "documentMention",
	priority: 1100,

	addAttributes() {
		return {
			...this.parent?.(),
			blockId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-block-id", attributes.blockId),
			},
			assetId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-asset-id", attributes.assetId),
			},
			assetKind: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-kind"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-asset-kind", attributes.assetKind),
			},
			category: {
				default: fallbackMentionCategory,
				parseHTML: (element: HTMLElement) =>
					element.getAttribute("data-category") ?? fallbackMentionCategory,
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-category", attributes.category),
			},
			documentId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-document-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-document-id", attributes.documentId),
			},
			mimeType: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-mime-type"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-mime-type", attributes.mimeType),
			},
			kind: {
				default: "document",
				parseHTML: (element: HTMLElement) => element.getAttribute("data-kind") ?? "document",
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-kind", attributes.kind),
			},
			title: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-title"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-title", attributes.title),
			},
			url: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-url"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-url", attributes.url),
			},
		};
	},

	markdownTokenizer: {
		name: "documentMention",
		level: "inline",
		start(src: string) {
			return src.search(/@\[/);
		},
		tokenize(src: string) {
			const match = mentionLinkPattern.exec(src);
			if (!match) return undefined;

			const title = unescapeMentionLabel(match[1] ?? "");
			const href = match[2] ?? match[3] ?? "";
			const reference = parseMentionHref(href, title);
			if (!reference) return undefined;

			return {
				type: "documentMention",
				raw: match[0],
				attributes: attrsFromReference(reference),
			};
		},
	},

	parseMarkdown(token: MarkdownToken, helpers) {
		return helpers.createNode("documentMention", token.attributes ?? {}, []);
	},

	renderMarkdown(node: JSONContent) {
		const reference = referenceFromAttrs(node.attrs);
		return reference
			? mentionMarkdownFromReference(reference)
			: mentionDisplayText(node.attrs?.title);
	},
}).configure({
	deleteTriggerWithBackspace: true,
	HTMLAttributes: {
		class: "agent-reference-mention",
	},
	renderHTML: ({ node, options }) => [
		"span",
		{
			...options.HTMLAttributes,
			...mentionDataAttributes(node.attrs),
		},
		mentionDisplayText(node.attrs.title ?? node.attrs.label ?? node.attrs.id),
	],
	renderText: ({ node }) =>
		mentionDisplayText(node.attrs.title ?? node.attrs.label ?? node.attrs.id),
	suggestion: createMentionSuggestion() as Omit<SuggestionOptions, "editor">,
});

const attrsFromReference = (reference: AgentReference) => ({
	...(reference.assetId ? { assetId: reference.assetId } : {}),
	...(reference.assetKind ? { assetKind: reference.assetKind } : {}),
	...(reference.blockId ? { blockId: reference.blockId } : {}),
	...(reference.category ? { category: reference.category } : {}),
	...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
	documentId:
		reference.kind === "asset" ? (reference.assetId ?? reference.documentId) : reference.documentId,
	id:
		reference.kind === "asset"
			? (reference.assetId ?? reference.documentId)
			: reference.kind === "section" && reference.blockId
				? reference.blockId
				: reference.documentId,
	kind: reference.kind,
	label: reference.title,
	title: reference.title,
	...(reference.url ? { url: reference.url } : {}),
});

const mentionDataAttributes = (attrs: JSONContent["attrs"]) => ({
	...renderDataAttribute("data-asset-id", attrs?.assetId),
	...renderDataAttribute("data-asset-kind", attrs?.assetKind),
	...renderDataAttribute("data-block-id", attrs?.blockId),
	...renderDataAttribute("data-category", mentionCategoryAttribute(attrs)),
	...renderDataAttribute("data-document-id", attrs?.documentId),
	...renderDataAttribute("data-kind", attrs?.kind),
	...renderDataAttribute("data-mime-type", attrs?.mimeType),
	...renderDataAttribute("data-title", attrs?.title ?? attrs?.label),
	...renderDataAttribute("data-url", attrs?.url),
});

const referenceFromAttrs = (attrs: JSONContent["attrs"]): AgentReference | null => {
	const kind =
		attrs?.kind === "section" ? "section" : attrs?.kind === "asset" ? "asset" : "document";
	const documentId = stringAttribute(attrs?.documentId);
	const title = stringAttribute(attrs?.title) || stringAttribute(attrs?.label);
	if (!documentId || !title) return null;

	if (kind === "asset") {
		const assetId = stringAttribute(attrs?.assetId) || documentId;
		return {
			kind,
			documentId: assetId,
			assetId,
			assetKind: stringAttribute(attrs?.assetKind),
			mimeType: stringAttribute(attrs?.mimeType),
			title,
			category: fallbackMentionCategory,
			url: stringAttribute(attrs?.url),
		};
	}

	const blockId = kind === "section" ? stringAttribute(attrs?.blockId) : undefined;
	const category = mentionCategoryAttribute(attrs);

	return {
		kind,
		documentId,
		...(blockId ? { blockId } : {}),
		title,
		...(category ? { category } : {}),
	};
};

const mentionCategoryAttribute = (attrs: JSONContent["attrs"]) => {
	const explicitCategory = documentCategory(attrs?.category);
	if (explicitCategory && explicitCategory !== fallbackMentionCategory) return explicitCategory;

	const kind =
		attrs?.kind === "section" ? "section" : attrs?.kind === "asset" ? "asset" : "document";
	if (kind === "asset") return explicitCategory ?? fallbackMentionCategory;

	const documentId = stringAttribute(attrs?.documentId);
	const document = documentId
		? useDocumentsStore.getState().documents.find((item) => item.id === documentId)
		: null;

	return documentCategory(document?.category) ?? explicitCategory ?? fallbackMentionCategory;
};

const unescapeMentionLabel = (value: string) => value.replace(/\\([\\[\]])/g, "$1");
