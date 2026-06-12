import type {
	DocumentBlockAttrs as ProtocolDocumentBlockAttrs,
	LinkMarkAttrs as ProtocolLinkMarkAttrs,
	MentionAttrs as ProtocolMentionAttrs,
} from "@/api/types/document-tools";

export type DocumentToolBlockAttrs = ProtocolDocumentBlockAttrs;

export type DocumentToolInlineMarkAttrs = ProtocolLinkMarkAttrs;

export type DocumentToolInlineContentAttrs = ProtocolMentionAttrs;

export interface CodeBlockAttrs {
	language: string;
}

export interface HeadingBlockAttrs {
	level: number;
}

export interface ListBlockAttrs {
	ordered: boolean;
}

export interface LinkMarkAttrs {
	href: string;
}

export interface MentionAttrs {
	id: string;
	label: string;
}

type AttrsInput = object | null | undefined;

export const codeBlockAttrs = (attrs: AttrsInput): CodeBlockAttrs => ({
	language: stringAttr(attrs, "language"),
});

export const headingBlockAttrs = (attrs: AttrsInput): HeadingBlockAttrs => ({
	level: intAttr(attrs, "level"),
});

export const listBlockAttrs = (attrs: AttrsInput): ListBlockAttrs => ({
	ordered: boolAttr(attrs, "ordered"),
});

export const linkMarkAttrs = (attrs: AttrsInput): LinkMarkAttrs => ({
	href: stringAttr(attrs, "href"),
});

export const mentionAttrs = (attrs: AttrsInput): MentionAttrs => ({
	id: stringAttr(attrs, "id"),
	label: stringAttr(attrs, "label"),
});

export const stringAttr = (attrs: AttrsInput, key: string): string => {
	const value = attrValue(attrs, key);
	if (typeof value === "string") return value.trim();
	if (value === null || value === undefined) return "";
	return String(value).trim();
};

export const boolAttr = (attrs: AttrsInput, key: string): boolean => {
	const value = attrValue(attrs, key);
	if (typeof value === "boolean") return value;
	return String(value).toLowerCase() === "true";
};

export const intAttr = (attrs: AttrsInput, key: string): number => {
	const value = attrValue(attrs, key);
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
};

const attrValue = (attrs: AttrsInput, key: string): unknown =>
	attrs == null ? undefined : (attrs as Record<string, unknown>)[key];
