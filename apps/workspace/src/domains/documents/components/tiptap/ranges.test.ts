import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { createTextNodeRangeResolver } from "./ranges";

describe("text node range resolver", () => {
	it("resolves multiple anchors from one ProseMirror text index", () => {
		const editor = new Editor({
			extensions: [StarterKit, Markdown],
			content: "Alpha Beta and Beta tail\n\nGamma closes",
			contentType: "markdown",
		});

		try {
			const resolver = createTextNodeRangeResolver(editor.state.doc);
			const firstBeta = resolver.findRange({
				quote: "Beta",
				contextBefore: "Alpha ",
				contextAfter: " and",
			});
			const gamma = resolver.findRange("Gamma");

			expect(textForRange(editor, firstBeta)).toBe("Beta");
			expect(textForRange(editor, gamma)).toBe("Gamma");
		} finally {
			editor.destroy();
		}
	});

	it("supports token fallback for fuzzy anchors", () => {
		const editor = new Editor({
			extensions: [StarterKit, Markdown],
			content: "Alpha Beta\n\nGamma closes",
			contentType: "markdown",
		});

		try {
			const resolver = createTextNodeRangeResolver(editor.state.doc);
			const range = resolver.findRange("Gamma missing", { fallbackToToken: true });

			expect(textForRange(editor, range)).toBe("Gamma");
		} finally {
			editor.destroy();
		}
	});
});

const textForRange = (editor: Editor, range: { from: number; to: number } | null) =>
	range ? editor.state.doc.textBetween(range.from, range.to, "\n") : null;
