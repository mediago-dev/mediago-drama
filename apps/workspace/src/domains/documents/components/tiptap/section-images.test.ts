import { describe, expect, it } from "vitest";
import type { MarkdownSectionIdentity } from "@/domains/documents/lib/editor-registry";
import { sectionIdBeforeHeadingLine } from "@/domains/documents/lib/sections";
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

	it("keeps the next section id attached to its heading when inserting an image", () => {
		const section: MarkdownSectionIdentity = {
			blockId: "section_first",
			documentId: "doc-1",
			headingLevel: 2,
			headingOccurrence: 1,
			headingText: "第一节点",
		};
		const markdown = [
			"<!-- section-id: section_first -->",
			"## 第一节点",
			"",
			"第一段正文",
			"",
			"<!-- section-id: section_second -->",
			"## 第二节点",
			"",
			"第二段正文",
		].join("\n");

		const result = appendSectionImageMarkdown(markdown, section, {
			src: "/api/v1/media-assets/image-1/content",
			title: "第一节点图",
		});
		const lines = result?.markdown.split("\n") ?? [];
		const nextHeadingIndex = lines.findIndex((line) => line === "## 第二节点");

		expect(result?.changed).toBe(true);
		expect(result?.markdown).toContain("![第一节点图](</api/v1/media-assets/image-1/content>)");
		expect(nextHeadingIndex).toBeGreaterThan(0);
		expect(sectionIdBeforeHeadingLine(lines, nextHeadingIndex)).toBe("section_second");
	});
});
