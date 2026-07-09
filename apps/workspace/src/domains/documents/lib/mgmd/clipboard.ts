import type { JSONContent } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { serializeMarkdownNodes } from "@/domains/documents/components/tiptap/ranges";
import { stripSectionIdCommentLines } from "@/domains/documents/lib/sections";

const fragmentText = (slice: Slice): string =>
	slice.content.textBetween(0, slice.content.size, "\n\n");

/**
 * Serialize a copied ProseMirror slice to the `text/plain` clipboard flavor as
 * clean Markdown with the invisible `<!-- section-id -->` comments removed.
 *
 * Block selections become real Markdown (so pasting into another editor keeps
 * the formatting); inline / partial selections fall back to plain text. In
 * every case no section-id leaves the app — see docs/mgmd-spec.md §7.
 */
export const sliceToCleanMarkdown = (editor: Editor | null, slice: Slice): string => {
	if (!editor || slice.content.size === 0) return fragmentText(slice);

	const nodes = slice.content.toJSON() as JSONContent[] | null;
	const markdown = nodes ? serializeMarkdownNodes(editor, nodes) : null;
	if (!markdown) return fragmentText(slice);

	const cleaned = stripSectionIdCommentLines(markdown).trim();
	return cleaned || fragmentText(slice);
};
