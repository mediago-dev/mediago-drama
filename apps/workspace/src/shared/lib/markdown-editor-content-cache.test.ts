import type { Editor, JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownEditorContentCache } from "./markdown-editor-content-cache";

const editorWithJSON = (json: JSONContent) =>
	({
		getJSON: () => json,
		isDestroyed: false,
	}) as unknown as Editor;

describe("createMarkdownEditorContentCache", () => {
	it("keeps recently used parsed documents within the configured limit", () => {
		const cache = createMarkdownEditorContentCache(2);
		const firstJSON = { content: [{ text: "first", type: "text" }], type: "doc" };
		const secondJSON = { content: [{ text: "second", type: "text" }], type: "doc" };
		const thirdJSON = { content: [{ text: "third", type: "text" }], type: "doc" };

		cache.remember("first", "first", editorWithJSON(firstJSON));
		cache.remember("second", "second", editorWithJSON(secondJSON));
		expect(cache.cached("first", "first")).toEqual(firstJSON);

		cache.remember("third", "third", editorWithJSON(thirdJSON));
		expect(cache.cached("second", "second")).toBeNull();
		expect(cache.cached("first", "first")).toEqual(firstJSON);
		expect(cache.cached("third", "third")).toEqual(thirdJSON);
	});

	it("does not serialize the same cached document again", () => {
		const cache = createMarkdownEditorContentCache();
		const getJSON = vi.fn(() => ({ content: [{ text: "same", type: "text" }], type: "doc" }));
		const editor = { getJSON, isDestroyed: false } as unknown as Editor;

		cache.remember("same", "same", editor);
		cache.remember("same", "same", editor);

		expect(getJSON).toHaveBeenCalledOnce();
	});
});
