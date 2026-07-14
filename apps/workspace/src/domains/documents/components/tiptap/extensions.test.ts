import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { createBlockHandleExtension } from "./extensions";
import { findTopLevelBlockRangeByIndex } from "./ranges";
import { blockHandleStorage } from "./storage";

describe("block handle extension", () => {
	it("skips stale hover decoration ranges after the document shrinks", () => {
		const editor = createEditor("Alpha\n\nBeta");

		try {
			blockHandleStorage(editor).hoveredRange = {
				from: 0,
				headingLevel: undefined,
				index: 0,
				nodeType: "paragraph",
				text: "Alpha",
				to: 9999,
			};

			expect(() => renderBlockHandleDecorations(editor)).not.toThrow();
		} finally {
			editor.destroy();
		}
	});

	it("clears the cached hover range when the document changes", () => {
		const onHoverChange = vi.fn();
		const editor = createEditor("Alpha\n\nBeta", onHoverChange);

		try {
			const firstRange = findTopLevelBlockRangeByIndex(editor.state.doc, 0);
			if (!firstRange) throw new Error("missing first block");

			const storage = blockHandleStorage(editor);
			storage.hoveredRange = firstRange;

			editor.commands.setContent("Short", {
				contentType: "markdown",
				emitUpdate: false,
			});

			expect(storage.hoveredRange).toBeNull();
			expect(onHoverChange).toHaveBeenCalledWith(null);
			expect(() => renderBlockHandleDecorations(editor)).not.toThrow();
		} finally {
			editor.destroy();
		}
	});

	it("clears the block handle when coordinates resolve to a block outside its visual bounds", () => {
		const onHoverChange = vi.fn();
		const editor = createEditor("Alpha\n\nBeta", onHoverChange);

		try {
			const firstRange = findTopLevelBlockRangeByIndex(editor.state.doc, 0);
			if (!firstRange) throw new Error("missing first block");

			const element = editor.view.nodeDOM(firstRange.from);
			if (!(element instanceof HTMLElement)) throw new Error("missing first block element");

			vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: firstRange.from, pos: 1 });
			vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 400, 28));
			blockHandleStorage(editor).hoveredRange = firstRange;

			editor.view.dom.dispatchEvent(
				new MouseEvent("mousemove", {
					bubbles: true,
					clientX: 120,
					clientY: 200,
				}),
			);

			expect(blockHandleStorage(editor).hoveredRange).toBeNull();
			expect(onHoverChange).toHaveBeenCalledWith(null);
		} finally {
			editor.destroy();
		}
	});
});

const createEditor = (content: string, onHoverChange: (rect: DOMRect | null) => void = () => {}) =>
	new Editor({
		extensions: [StarterKit, createBlockHandleExtension(onHoverChange), Markdown],
		content,
		contentType: "markdown",
	});

const renderBlockHandleDecorations = (editor: Editor) => {
	let decorations: unknown = null;
	editor.view.someProp("decorations", (renderDecorations) => {
		decorations = renderDecorations(editor.state);
		return true;
	});
	return decorations;
};
