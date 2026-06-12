import { describe, expect, it } from "vitest";
import type { MarkdownSectionIdentity } from "@/domains/documents/lib/editor-registry";
import { appendSectionImageMarkdown } from "./section-images";

describe("section image markdown", () => {
	it("locates a section by persisted section-id before falling back to heading text", () => {
		const section: MarkdownSectionIdentity = {
			blockId: "section_visual",
			documentId: "doc-1",
			headingLevel: 2,
			headingOccurrence: 99,
			headingText: "旧标题",
		};
		const markdown = [
			"<!-- section-id: section_visual -->",
			"## 新标题",
			"",
			"正文",
			"",
			"## 新标题",
			"",
			"另一个同名区块",
		].join("\n");

		const result = appendSectionImageMarkdown(markdown, section, {
			src: "/api/v1/media-assets/image-1/content",
			title: "插图",
		});

		expect(result?.changed).toBe(true);
		expect(result?.markdown).toBe(
			[
				"<!-- section-id: section_visual -->",
				"## 新标题",
				"",
				"正文",
				"",
				"![插图](</api/v1/media-assets/image-1/content>)",
				"## 新标题",
				"",
				"另一个同名区块",
			].join("\n"),
		);
	});
});
