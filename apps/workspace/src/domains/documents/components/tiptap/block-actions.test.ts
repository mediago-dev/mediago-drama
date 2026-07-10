import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { afterEach, describe, expect, it } from "vitest";
import {
	activeBlockConversion,
	blockTextAlign,
	canConvertBlock,
	canOutdentBlock,
	convertBlock,
	deleteBlock,
	indentBlock,
	insertBlockAfter,
	outdentBlock,
	setBlockAlign,
} from "./block-actions";
import { findTopLevelBlockRangeByIndex } from "./ranges";

const createEditor = (content: string) =>
	new Editor({
		extensions: [StarterKit, TextAlign.configure({ types: ["heading", "paragraph"] }), Markdown],
		content,
		contentType: "markdown",
	});

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

describe("block-actions", () => {
	it("converts a paragraph to a heading and back", () => {
		editor = createEditor("Alpha\n\nBeta");

		expect(convertBlock(editor, 0, { type: "heading", level: 2 })).toBe(true);
		expect(editor.state.doc.child(0).type.name).toBe("heading");
		expect(editor.state.doc.child(0).attrs.level).toBe(2);
		expect(editor.state.doc.child(0).textContent).toBe("Alpha");

		expect(convertBlock(editor, 0, { type: "paragraph" })).toBe(true);
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
	});

	it("converts a paragraph into a bullet list", () => {
		editor = createEditor("Alpha\n\nBeta");

		expect(convertBlock(editor, 1, { type: "bulletList" })).toBe(true);
		expect(editor.state.doc.child(1).type.name).toBe("bulletList");
	});

	it("deletes the target block", () => {
		editor = createEditor("Alpha\n\nBeta");
		expect(editor.state.doc.childCount).toBe(2);

		expect(deleteBlock(editor, 0)).toBe(true);
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.child(0).textContent).toBe("Beta");
	});

	it("inserts an empty paragraph after the target block", () => {
		editor = createEditor("Alpha\n\nBeta");

		expect(insertBlockAfter(editor, 0)).toBe(true);
		expect(editor.state.doc.childCount).toBe(3);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.doc.child(1).textContent).toBe("");
	});

	it("returns false for an out-of-range block index", () => {
		editor = createEditor("Alpha");

		expect(convertBlock(editor, 5, { type: "paragraph" })).toBe(false);
		expect(deleteBlock(editor, 5)).toBe(false);
		expect(insertBlockAfter(editor, 5)).toBe(false);
	});

	it("sets and reads block text alignment", () => {
		editor = createEditor("# Title\n\nBody");

		expect(blockTextAlign(editor, 0)).toBe("left");
		expect(setBlockAlign(editor, 0, "center")).toBe(true);
		expect(blockTextAlign(editor, 0)).toBe("center");
		expect(editor.state.doc.child(0).attrs.textAlign).toBe("center");

		expect(setBlockAlign(editor, 0, "right")).toBe(true);
		expect(blockTextAlign(editor, 0)).toBe("right");
	});

	it("does not allow indent/outdent on non-list blocks", () => {
		editor = createEditor("Alpha");

		expect(canOutdentBlock(editor, 0)).toBe(false);
		expect(outdentBlock(editor, 0)).toBe(false);
		// A single top-level paragraph has no list item to nest.
		expect(indentBlock(editor, 0)).toBe(false);
	});

	it("reports the active conversion and convertibility for a block range", () => {
		editor = createEditor("# Title\n\nBody");

		const headingRange = findTopLevelBlockRangeByIndex(editor.state.doc, 0);
		expect(canConvertBlock(headingRange)).toBe(true);
		expect(activeBlockConversion(headingRange)).toEqual({ type: "heading", level: 1 });

		const paragraphRange = findTopLevelBlockRangeByIndex(editor.state.doc, 1);
		expect(activeBlockConversion(paragraphRange)).toEqual({ type: "paragraph" });
	});
});
