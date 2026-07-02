import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { MarkdownSectionIdentity } from "@/domains/documents/lib/editor-registry";
import {
	createSectionBlockId,
	createSectionId,
	documentSectionHeadingLevel,
	normalizeHeadingText,
	normalizeSectionId,
	sectionIdAnchorNodeName,
} from "@/domains/documents/lib/sections";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import { findTopLevelBlockRangeByIndex, serializeMarkdownNodes } from "./ranges";
import type { BlockRange } from "./types";

export interface MarkdownSectionContext extends MarkdownSectionIdentity {
	markdown: string;
	plainText: string;
	prompt: string;
}

export interface MarkdownHeadingContext extends MarkdownSectionIdentity {}

export const ensureMarkdownHeadingSectionId = (
	editor: Editor,
	headingRange: BlockRange,
): BlockRange | null => {
	if (headingRange.nodeType !== "heading") return null;
	if (headingRange.headingLevel !== documentSectionHeadingLevel) return null;

	const anchorIndex = findSectionIdAnchorIndexForHeading(editor.state.doc, headingRange.index);
	const existingIdsBefore = collectSectionIdsBefore(
		editor.state.doc,
		anchorIndex,
		headingRange.index,
	);

	if (anchorIndex >= 0) {
		const anchorNode = editor.state.doc.child(anchorIndex);
		const currentSectionId = sectionIdFromAnchorNode(anchorNode);
		if (currentSectionId && !existingIdsBefore.has(currentSectionId)) {
			return findTopLevelBlockRangeByIndex(editor.state.doc, headingRange.index);
		}

		const nextSectionId = createSectionId(collectSectionIds(editor.state.doc));
		const anchorRange = findTopLevelBlockRangeByIndex(editor.state.doc, anchorIndex);
		if (!anchorRange) return null;

		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(anchorRange.from, undefined, {
				...anchorNode.attrs,
				sectionId: nextSectionId,
			}),
		);
		return findTopLevelBlockRangeByIndex(editor.state.doc, headingRange.index);
	}

	const sectionId = createSectionId(collectSectionIds(editor.state.doc));
	const inserted = editor.commands.insertContentAt(
		headingRange.from,
		{
			type: sectionIdAnchorNodeName,
			attrs: { sectionId },
		},
		{ updateSelection: false },
	);
	if (!inserted) return null;

	return findTopLevelBlockRangeByIndex(editor.state.doc, headingRange.index + 1);
};

export const createMarkdownSectionContext = (
	editor: Editor,
	documentId: string,
	headingRange: BlockRange,
): MarkdownSectionContext | null => {
	if (headingRange.nodeType !== "heading") return null;

	const heading = createMarkdownHeadingContext(editor, documentId, headingRange);
	if (!heading) return null;
	const { headingLevel, headingOccurrence, headingText } = heading;
	const sectionNodes: JSONContent[] = [];
	const plainTextParts: string[] = [];

	for (let index = headingRange.index; index < editor.state.doc.childCount; index += 1) {
		const node = editor.state.doc.child(index);
		const level = node.type.name === "heading" ? Number(node.attrs.level ?? 1) : undefined;
		if (
			index > headingRange.index &&
			node.type.name === "heading" &&
			typeof level === "number" &&
			level <= headingLevel
		) {
			break;
		}

		if (node.type.name !== sectionIdAnchorNodeName) {
			const json = node.toJSON() as JSONContent;
			sectionNodes.push(json);
		}

		const text = node.textContent.trim();
		if (text) {
			plainTextParts.push(text);
		}
	}

	const markdown = serializeMarkdownNodes(editor, sectionNodes)?.trim();
	if (!markdown) return null;

	return {
		blockId: heading.blockId,
		documentId,
		headingLevel,
		headingOccurrence,
		headingText,
		markdown,
		plainText: plainTextParts.join("\n\n").trim(),
		prompt: createSectionGenerationPrompt(markdown, headingText),
	};
};

export const createMarkdownHeadingContext = (
	editor: Editor,
	documentId: string,
	headingRange: BlockRange,
): MarkdownHeadingContext | null => {
	if (headingRange.nodeType !== "heading") return null;

	const headingNode = editor.state.doc.child(headingRange.index);
	const headingLevel = Number(headingNode.attrs.level ?? headingRange.headingLevel ?? 1);
	if (headingLevel !== documentSectionHeadingLevel) return null;
	const headingText = headingNode.textContent.trim() || "未命名标题";
	const headingOccurrence = countHeadingOccurrence(
		editor.state.doc,
		headingRange.index,
		headingLevel,
		headingText,
	);
	const sectionId = sectionIdForHeading(editor.state.doc, headingRange.index);

	return {
		blockId:
			sectionId ?? createSectionBlockId(documentId, headingLevel, headingOccurrence, headingText),
		documentId,
		headingLevel,
		headingOccurrence,
		headingText,
	};
};

const sectionIdForHeading = (doc: ProseMirrorNode, headingIndex: number) => {
	const anchorIndex = findSectionIdAnchorIndexForHeading(doc, headingIndex);
	if (anchorIndex < 0) return null;
	const sectionId = sectionIdFromAnchorNode(doc.child(anchorIndex));
	if (!sectionId) return null;
	if (collectSectionIdsBefore(doc, anchorIndex, headingIndex).has(sectionId)) return null;
	return sectionId;
};

const findSectionIdAnchorIndexForHeading = (doc: ProseMirrorNode, headingIndex: number) => {
	for (let index = headingIndex - 1; index >= 0; index -= 1) {
		const node = doc.child(index);
		if (node.type.name === sectionIdAnchorNodeName) return index;
		if (node.type.name === "paragraph" && !node.textContent.trim()) continue;
		return -1;
	}
	return -1;
};

const collectSectionIds = (doc: ProseMirrorNode) => {
	const sectionIds = new Set<string>();
	for (let index = 0; index < doc.childCount; index += 1) {
		const sectionId = sectionIdFromAnchorNode(doc.child(index));
		if (sectionId) sectionIds.add(sectionId);
	}
	return sectionIds;
};

const collectSectionIdsBefore = (
	doc: ProseMirrorNode,
	anchorIndex: number,
	headingIndex: number,
) => {
	const sectionIds = new Set<string>();
	const endIndex = anchorIndex >= 0 ? anchorIndex : headingIndex;
	for (let index = 0; index < endIndex; index += 1) {
		const sectionId = sectionIdFromAnchorNode(doc.child(index));
		if (sectionId) sectionIds.add(sectionId);
	}
	return sectionIds;
};

const sectionIdFromAnchorNode = (node: ProseMirrorNode) => {
	if (node.type.name !== sectionIdAnchorNodeName) return null;
	return normalizeSectionId(node.attrs.sectionId) || null;
};

const countHeadingOccurrence = (
	doc: ProseMirrorNode,
	headingIndex: number,
	headingLevel: number,
	headingText: string,
) => {
	let occurrence = 0;
	const normalizedText = normalizeHeadingText(headingText);
	for (let index = 0; index <= headingIndex && index < doc.childCount; index += 1) {
		const node = doc.child(index);
		if (node.type.name !== "heading") continue;
		const level = Number(node.attrs.level ?? 1);
		if (level !== headingLevel) continue;
		if (normalizeHeadingText(node.textContent) !== normalizedText) continue;
		occurrence += 1;
	}

	return Math.max(occurrence, 1);
};
