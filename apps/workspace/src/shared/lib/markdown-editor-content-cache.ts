import { Editor as CoreEditor, type Editor, type Extensions, type JSONContent } from "@tiptap/core";

interface MarkdownEditorContentCacheEntry {
	json: JSONContent;
	markdown: string;
}

export const createMarkdownEditorContentCache = (limit = 8) => {
	const cache = new Map<string, MarkdownEditorContentCacheEntry>();

	const cached = (cacheKey: string, markdown: string): JSONContent | null => {
		const entry = cache.get(cacheKey);
		if (!entry || entry.markdown !== markdown) return null;

		cache.delete(cacheKey);
		cache.set(cacheKey, entry);
		return entry.json;
	};

	const remember = (cacheKey: string, markdown: string, editor: Editor) => {
		if (!cacheKey || !markdown || editor.isDestroyed) return;
		if (cached(cacheKey, markdown)) return;

		cache.delete(cacheKey);
		cache.set(cacheKey, {
			json: editor.getJSON(),
			markdown,
		});

		while (cache.size > limit) {
			const oldestKey = cache.keys().next().value;
			if (!oldestKey) break;
			cache.delete(oldestKey);
		}
	};

	const prewarm = ({
		cacheKey,
		extensions,
		markdown,
	}: {
		cacheKey: string;
		extensions: Extensions;
		markdown: string;
	}) => {
		if (!cacheKey || !markdown || cached(cacheKey, markdown)) return;

		const editor = new CoreEditor({
			editable: false,
			extensions,
			content: markdown,
			contentType: "markdown",
		});
		remember(cacheKey, markdown, editor);
		editor.destroy();
	};

	return { cached, prewarm, remember };
};
