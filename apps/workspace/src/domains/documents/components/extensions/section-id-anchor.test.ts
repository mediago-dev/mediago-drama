import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { sectionIdAnchorNodeName } from "@/domains/documents/lib/sections";
import { SectionIdAnchor } from "./section-id-anchor";

describe("SectionIdAnchor", () => {
	it("preserves section-id comments through markdown parse and render", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: "<!-- section-id: section_abc -->\n## 幻师\n\n正文",
			contentType: "markdown",
		});

		expect(editor.getJSON().content?.[0]?.type).toBe(sectionIdAnchorNodeName);
		expect(editor.getMarkdown()).toContain("<!-- section-id: section_abc -->");
		expect(editor.getMarkdown()).toContain("## 幻师");

		editor.destroy();
	});
});
