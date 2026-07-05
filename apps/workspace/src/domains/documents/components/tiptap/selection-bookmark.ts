import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

export interface VisibleTextSelectionBookmark {
	from: number;
	fromBlock: TextBlockSelectionBookmark | null;
	textBlocks: string[];
	to: number;
	toBlock: TextBlockSelectionBookmark | null;
}

interface TextBlockSelectionBookmark {
	index: number;
	offset: number;
}

export const createVisibleTextSelectionBookmark = (
	editor: Editor,
): VisibleTextSelectionBookmark => {
	const { doc, selection } = editor.state;
	return {
		from: selection.from,
		fromBlock: textBlockSelectionBookmarkAtPosition(doc, selection.from),
		textBlocks: visibleTextBlocksFromDoc(doc),
		to: selection.to,
		toBlock: textBlockSelectionBookmarkAtPosition(doc, selection.to),
	};
};

export const restoreVisibleTextSelectionBookmark = (
	editor: Editor,
	bookmark: VisibleTextSelectionBookmark,
) => {
	const { doc } = editor.state;
	const size = doc.content.size;
	const textBlocksUnchanged = sameStringList(visibleTextBlocksFromDoc(doc), bookmark.textBlocks);
	const from =
		textBlocksUnchanged && bookmark.fromBlock
			? positionAtTextBlockBookmark(doc, bookmark.fromBlock)
			: clampDocumentPosition(bookmark.from, size);
	const to =
		textBlocksUnchanged && bookmark.toBlock
			? positionAtTextBlockBookmark(doc, bookmark.toBlock)
			: clampDocumentPosition(bookmark.to, size);

	try {
		editor.commands.setTextSelection({
			from: Math.min(from, to),
			to: Math.max(from, to),
		});
		return true;
	} catch {
		return false;
	}
};

export const visibleTextFromDoc = (doc: ProseMirrorNode) =>
	doc.textBetween(0, doc.content.size, "", "");

export const visibleTextBlocksFromDoc = (doc: ProseMirrorNode) => {
	const blocks: string[] = [];
	doc.descendants((node) => {
		if (!node.isTextblock) return true;

		blocks.push(node.textBetween(0, node.content.size, "", ""));
		return false;
	});
	return blocks;
};

const textBlockSelectionBookmarkAtPosition = (
	doc: ProseMirrorNode,
	position: number,
): TextBlockSelectionBookmark | null => {
	const target = clampDocumentPosition(position, doc.content.size);
	let index = 0;
	let bookmark: TextBlockSelectionBookmark | null = null;

	doc.descendants((node, nodePosition) => {
		if (bookmark) return false;
		if (!node.isTextblock) return true;

		const start = nodePosition + 1;
		const end = start + node.content.size;
		if (target >= start && target <= end) {
			bookmark = {
				index,
				offset: target - start,
			};
			return false;
		}

		index += 1;
		return false;
	});

	return bookmark;
};

const positionAtTextBlockBookmark = (
	doc: ProseMirrorNode,
	bookmark: TextBlockSelectionBookmark,
) => {
	let index = 0;
	let restoredPosition = firstTextSelectionPosition(doc);
	let found = false;
	doc.descendants((node, nodePosition) => {
		if (found) return false;
		if (!node.isTextblock) return true;

		if (index === bookmark.index) {
			const offset = Math.max(0, Math.min(bookmark.offset, node.content.size));
			restoredPosition = nodePosition + 1 + offset;
			found = true;
			return false;
		}

		index += 1;
		return false;
	});

	return clampDocumentPosition(restoredPosition, doc.content.size);
};

const firstTextSelectionPosition = (doc: ProseMirrorNode) => {
	let fallback = 0;
	let found = false;
	doc.descendants((node, position) => {
		if (found) return false;
		if (!node.isTextblock) return true;

		fallback = position + 1;
		found = true;
		return false;
	});
	return fallback;
};

const clampDocumentPosition = (position: number, size: number) =>
	Math.max(0, Math.min(position, size));

const sameStringList = (left: string[], right: string[]) =>
	left.length === right.length && left.every((value, index) => value === right[index]);
