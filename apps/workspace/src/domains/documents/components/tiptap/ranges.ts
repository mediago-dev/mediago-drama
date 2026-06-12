import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { MarkdownBlockDeltaOptions } from "@/domains/documents/lib/editor-registry";
import { findTextAnchorMatch, type TextAnchorInput } from "@/domains/documents/lib/operations";
import type { BlockRange, StreamingBlockTarget } from "./types";

export const findTextNodeRange = (
	doc: ProseMirrorNode,
	anchor: TextAnchorInput,
): { from: number; to: number } | null => {
	const textNodes = collectTextNodes(doc);
	const fullText = textNodes.map((item) => item.text).join("");
	const match = findTextAnchorMatch(fullText, anchor);
	if (!match) return null;

	const start = resolveTextPosition(textNodes, match.start);
	const end = resolveTextPosition(textNodes, match.end);
	if (start === null || end === null || start === end) return null;

	return {
		from: Math.min(start, end),
		to: Math.max(start, end),
	};
};

interface TextNodePosition {
	end: number;
	position: number;
	start: number;
	text: string;
}

const collectTextNodes = (doc: ProseMirrorNode): TextNodePosition[] => {
	const textNodes: TextNodePosition[] = [];
	let offset = 0;
	doc.descendants((node, position) => {
		if (!node.isText || !node.text) return true;

		textNodes.push({
			end: offset + node.text.length,
			position,
			start: offset,
			text: node.text,
		});
		offset += node.text.length;
		return true;
	});
	return textNodes;
};

const resolveTextPosition = (nodes: TextNodePosition[], offset: number) => {
	for (const item of nodes) {
		if (offset >= item.start && offset <= item.end) {
			return item.position + Math.min(Math.max(offset - item.start, 0), item.text.length);
		}
	}

	const last = nodes.at(-1);
	return last ? last.position + last.text.length : null;
};

export const findTopLevelBlockRange = (
	doc: ProseMirrorNode,
	position: number,
): BlockRange | null => {
	if (doc.childCount === 0) return null;

	const resolved = doc.resolve(Math.min(Math.max(position, 0), doc.content.size));
	if (resolved.depth >= 1) {
		return topLevelBlockRangeFromBefore(doc, resolved.before(1));
	}

	return topLevelBlockRangeFromBefore(doc, 0);
};

export const findTopLevelBlockRangeByIndex = (
	doc: ProseMirrorNode,
	index: number,
): BlockRange | null => {
	if (index < 0 || index >= doc.childCount) return null;

	let from = 0;
	for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
		from += doc.child(currentIndex).nodeSize;
	}

	const node = doc.child(index);
	return {
		from,
		headingLevel: node.type.name === "heading" ? Number(node.attrs.level ?? 1) : undefined,
		index,
		nodeType: node.type.name,
		text: node.textContent,
		to: from + node.nodeSize,
	};
};

const topLevelBlockRangeFromBefore = (doc: ProseMirrorNode, before: number): BlockRange | null => {
	let from = 0;
	for (let index = 0; index < doc.childCount; index += 1) {
		const node = doc.child(index);
		const to = from + node.nodeSize;
		if (before >= from && before < to) return findTopLevelBlockRangeByIndex(doc, index);
		from = to;
	}

	const lastIndex = doc.childCount - 1;
	return lastIndex >= 0 ? findTopLevelBlockRangeByIndex(doc, lastIndex) : null;
};

export const sameBlockRange = (first: BlockRange | null, second: BlockRange | null) =>
	first?.from === second?.from && first?.to === second?.to && first?.index === second?.index;

export const resolveStreamingTarget = (
	editor: Editor,
	currentTarget: StreamingBlockTarget | null,
	anchorText: string,
): StreamingBlockTarget | null => {
	const normalizedAnchor = anchorText.trim();
	if (!normalizedAnchor) return null;

	if (
		currentTarget?.anchorText === normalizedAnchor &&
		findTopLevelBlockRangeByIndex(editor.state.doc, currentTarget.blockIndex)
	) {
		return currentTarget;
	}

	const range = findTextNodeRange(editor.state.doc, normalizedAnchor);
	if (!range) return null;

	const blockRange = findTopLevelBlockRange(editor.state.doc, range.from);
	if (!blockRange) return null;

	return {
		anchorText: normalizedAnchor,
		baseMarkdown: editor.getMarkdown(),
		blockIndex: blockRange.index,
	};
};

export const resolveReplacementMarkdown = (
	editor: Editor,
	target: StreamingBlockTarget,
	content: string,
	options?: MarkdownBlockDeltaOptions,
) => {
	if (!content) return null;
	if (!options?.fullDocument) return content;

	return extractChangedTopLevelMarkdown(editor, target, content) ?? null;
};

const extractChangedTopLevelMarkdown = (
	editor: Editor,
	target: StreamingBlockTarget,
	nextMarkdown: string,
) => {
	const baseDoc = parseMarkdownDocument(editor, target.baseMarkdown);
	const nextDoc = parseMarkdownDocument(editor, nextMarkdown);
	const baseNodes = baseDoc?.content ?? [];
	const nextNodes = nextDoc?.content ?? [];
	if (baseNodes.length === 0 || nextNodes.length === 0) return null;

	const baseRendered = baseNodes.map(
		(node) => serializeMarkdownNodes(editor, [node])?.trim() ?? "",
	);
	const nextRendered = nextNodes.map(
		(node) => serializeMarkdownNodes(editor, [node])?.trim() ?? "",
	);
	let prefix = 0;
	const maxPrefix = Math.min(baseRendered.length, nextRendered.length);
	while (prefix < maxPrefix && baseRendered[prefix] === nextRendered[prefix]) {
		prefix += 1;
	}

	let suffix = 0;
	const maxSuffix = Math.min(baseRendered.length - prefix, nextRendered.length - prefix);
	while (
		suffix < maxSuffix &&
		baseRendered[baseRendered.length - 1 - suffix] ===
			nextRendered[nextRendered.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const changedStart = prefix;
	const changedEnd = nextNodes.length - suffix;
	const baseChangedEnd = baseNodes.length - suffix;
	if (
		changedStart < changedEnd &&
		target.blockIndex >= changedStart &&
		target.blockIndex < baseChangedEnd
	) {
		const changedMarkdown = serializeMarkdownNodes(
			editor,
			nextNodes.slice(changedStart, changedEnd),
		);
		if (changedMarkdown?.trim()) return changedMarkdown;
	}

	const fallbackNode = nextNodes[target.blockIndex];
	return fallbackNode ? serializeMarkdownNodes(editor, [fallbackNode]) : null;
};

export const diffTopLevelBlocks = (
	editor: Editor,
	prevMarkdown: string,
	nextMarkdown: string,
): { blockIndex: number; markdown: string } | null => {
	const baseDoc = parseMarkdownDocument(editor, prevMarkdown);
	const nextDoc = parseMarkdownDocument(editor, nextMarkdown);
	const baseNodes = baseDoc?.content ?? [];
	const nextNodes = nextDoc?.content ?? [];
	if (baseNodes.length === 0 || baseNodes.length !== nextNodes.length) return null;

	let changedIndex = -1;
	for (let index = 0; index < baseNodes.length; index += 1) {
		const baseMarkdown = serializeMarkdownNodes(editor, [baseNodes[index]])?.trim() ?? "";
		const changedMarkdown = serializeMarkdownNodes(editor, [nextNodes[index]])?.trim() ?? "";
		if (baseMarkdown === changedMarkdown) continue;
		if (changedIndex >= 0) return null;
		changedIndex = index;
	}

	if (changedIndex < 0) return null;

	const markdown = serializeMarkdownNodes(editor, [nextNodes[changedIndex]]);
	return markdown?.trim() ? { blockIndex: changedIndex, markdown } : null;
};

export const parseMarkdownDocument = (editor: Editor, markdown: string) => {
	try {
		return editor.markdown?.parse(markdown) as JSONContent | undefined;
	} catch {
		return undefined;
	}
};

export const serializeMarkdownNodes = (editor: Editor, nodes: JSONContent[]) => {
	try {
		return editor.markdown?.serialize({ type: "doc", content: nodes });
	} catch {
		return null;
	}
};
