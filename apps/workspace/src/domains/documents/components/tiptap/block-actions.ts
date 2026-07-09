import type { Editor } from "@tiptap/react";
import { findTopLevelBlockRangeByIndex } from "./ranges";
import type { BlockRange } from "./types";

export type BlockConversion =
	| { type: "paragraph" }
	| { type: "heading"; level: 1 | 2 | 3 | 4 }
	| { type: "bulletList" }
	| { type: "orderedList" }
	| { type: "blockquote" }
	| { type: "codeBlock" };

const convertibleBlockTypes = new Set([
	"paragraph",
	"heading",
	"bulletList",
	"orderedList",
	"blockquote",
	"codeBlock",
]);

/** True when the block supports switching between paragraph / heading / list / quote / code. */
export const canConvertBlock = (range: BlockRange | null): boolean =>
	Boolean(range && convertibleBlockTypes.has(range.nodeType));

/** Returns the conversion that matches the block's current type, for active-state highlighting. */
export const activeBlockConversion = (range: BlockRange | null): BlockConversion | null => {
	if (!range) return null;
	switch (range.nodeType) {
		case "heading": {
			const level = range.headingLevel;
			return level === 1 || level === 2 || level === 3 || level === 4
				? { type: "heading", level }
				: null;
		}
		case "paragraph":
			return { type: "paragraph" };
		case "bulletList":
			return { type: "bulletList" };
		case "orderedList":
			return { type: "orderedList" };
		case "blockquote":
			return { type: "blockquote" };
		case "codeBlock":
			return { type: "codeBlock" };
		default:
			return null;
	}
};

const resolveRange = (editor: Editor, index: number) =>
	findTopLevelBlockRangeByIndex(editor.state.doc, index);

/** Convert the block at `index` to another block type. Positions are re-resolved to stay valid. */
export const convertBlock = (
	editor: Editor,
	index: number,
	conversion: BlockConversion,
): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	const chain = editor
		.chain()
		.focus()
		.setTextSelection(range.from + 1);
	switch (conversion.type) {
		case "paragraph":
			return chain.setParagraph().run();
		case "heading":
			return chain.toggleHeading({ level: conversion.level }).run();
		case "bulletList":
			return chain.toggleBulletList().run();
		case "orderedList":
			return chain.toggleOrderedList().run();
		case "blockquote":
			return chain.toggleBlockquote().run();
		case "codeBlock":
			return chain.toggleCodeBlock().run();
		default:
			return false;
	}
};

export type BlockAlign = "left" | "center" | "right";

/**
 * Read the block's current text alignment. Note: alignment is a visual-only
 * attribute — it is NOT representable in plain Markdown and does not survive a
 * save/reload round-trip. See docs/mgmd-spec.md (§L2 node attributes).
 */
export const blockTextAlign = (editor: Editor, index: number): BlockAlign => {
	const node = editor.state.doc.maybeChild(index);
	const align = node?.attrs?.textAlign;
	return align === "center" || align === "right" ? align : "left";
};

/** Set the block's text alignment (visual only — not persisted to Markdown). */
export const setBlockAlign = (editor: Editor, index: number, align: BlockAlign): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	return editor
		.chain()
		.focus()
		.setTextSelection(range.from + 1)
		.setTextAlign(align)
		.run();
};

/** Increase indentation by nesting the block's list item one level deeper. */
export const indentBlock = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	return editor
		.chain()
		.focus()
		.setTextSelection(range.from + 1)
		.sinkListItem("listItem")
		.run();
};

/** Decrease indentation by lifting the block's list item one level up. */
export const outdentBlock = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	return editor
		.chain()
		.focus()
		.setTextSelection(range.from + 1)
		.liftListItem("listItem")
		.run();
};

/** True when the block can be outdented (its list item is nested and can be lifted). */
export const canOutdentBlock = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	return editor
		.can()
		.chain()
		.setTextSelection(range.from + 1)
		.liftListItem("listItem")
		.run();
};

/** Delete the whole block at `index`. */
export const deleteBlock = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	return editor.chain().focus().setNodeSelection(range.from).deleteSelection().run();
};

/** Insert an empty paragraph directly after the block at `index` and place the caret in it. */
export const insertBlockAfter = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	const insertAt = range.to;
	return editor
		.chain()
		.focus()
		.insertContentAt(insertAt, { type: "paragraph" })
		.setTextSelection(insertAt + 1)
		.run();
};

/** Select the block's text so the selection-driven comment flow targets the whole block. */
export const selectBlockText = (editor: Editor, index: number): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	const from = Math.min(range.from + 1, range.to - 1);
	const to = Math.max(range.to - 1, range.from + 1);
	return editor.chain().focus().setTextSelection({ from, to }).run();
};

/**
 * Copy or cut the block via the browser clipboard so ProseMirror serializes both
 * text/html (carrying data-* attributes for round-trip) and text/plain. Must run
 * inside a user gesture. Returns false when the block cannot be resolved.
 */
export const copyBlock = (editor: Editor, index: number): boolean =>
	writeBlockToClipboard(editor, index, "copy");

export const cutBlock = (editor: Editor, index: number): boolean =>
	writeBlockToClipboard(editor, index, "cut");

const writeBlockToClipboard = (editor: Editor, index: number, command: "copy" | "cut"): boolean => {
	const range = resolveRange(editor, index);
	if (!range) return false;

	editor.chain().focus().setNodeSelection(range.from).run();
	if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
	return document.execCommand(command);
};
