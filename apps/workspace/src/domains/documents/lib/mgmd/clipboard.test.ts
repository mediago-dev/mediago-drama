import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownParsingExtensions } from "@/domains/documents/components/MarkdownHybridEditor";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import { sliceToCleanMarkdown } from "./clipboard";

const createEditor = (markdown: string) =>
	new Editor({
		extensions: createMarkdownParsingExtensions([DocumentMention]),
		content: markdown,
		contentType: "markdown",
	});

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

describe("sliceToCleanMarkdown", () => {
	it("serializes a block selection to markdown with section-id comments stripped", () => {
		editor = createEditor("<!-- section-id: section_abc123 -->\n\n## 林墨\n\n高三学生。");
		const slice = editor.state.doc.slice(0, editor.state.doc.content.size);

		const out = sliceToCleanMarkdown(editor, slice);

		expect(out).toContain("## 林墨");
		expect(out).toContain("高三学生。");
		expect(out).not.toContain("section-id");
		expect(out).not.toContain("<!--");
	});

	it("keeps a mention as clean markdown but never leaks section-id", () => {
		editor = createEditor(
			"<!-- section-id: section_xyz789 -->\n\n## 场景\n\n见 @[林墨](mention://doc/section_lin)。",
		);
		const slice = editor.state.doc.slice(0, editor.state.doc.content.size);

		const out = sliceToCleanMarkdown(editor, slice);

		expect(out).toContain("@[林墨](mention://doc/section_lin)");
		expect(out).not.toContain("section-id");
	});

	it("falls back to plain text for an inline selection", () => {
		editor = createEditor("## 标题\n\n一段正文内容。");
		// select "正文" inside the paragraph (inline, not a full block)
		const paragraphText = "一段正文内容。";
		const docText = editor.state.doc.textContent;
		const start = docText.indexOf("正文") + 1; // +1 to cross the paragraph boundary
		const slice = editor.state.doc.slice(start, start + 2);

		const out = sliceToCleanMarkdown(editor, slice);

		expect(out).not.toContain("#");
		expect(paragraphText).toContain(out.trim());
	});

	it("returns empty string for an empty slice", () => {
		editor = createEditor("正文");
		const slice = editor.state.doc.slice(0, 0);
		expect(sliceToCleanMarkdown(editor, slice)).toBe("");
	});
});
