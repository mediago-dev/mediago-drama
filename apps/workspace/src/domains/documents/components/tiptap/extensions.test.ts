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
