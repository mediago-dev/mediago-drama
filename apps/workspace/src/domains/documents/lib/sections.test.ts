import { describe, expect, it } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import {
	findMarkdownSectionHeadingLine,
	listDocumentSections,
	sectionIdBeforeHeadingLine,
	stripSectionIdCommentLines,
} from "./sections";

const document = (content: string): MarkdownDocument => ({
	id: "doc-1",
	title: "文档",
	content,
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-06-09T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

describe("document sections", () => {
	it("uses persisted section-id comments as section block ids", () => {
		const sections = listDocumentSections(
			document(
				[
					"<!-- section-id: section_first -->",
					"## 幻师",
					"",
					"正文",
					"",
					"<!-- section-id: section_second -->",
					"## 幻师",
				].join("\n"),
			),
		);

		expect(sections.map((section) => section.blockId)).toEqual(["section_first", "section_second"]);
	});

	it("finds heading lines by section-id and strips section-id comments from prompt text", () => {
		const lines = ["<!-- section-id: section_target -->", "", "## 新标题", "", "正文"];

		expect(sectionIdBeforeHeadingLine(lines, 2)).toBe("section_target");
		expect(
			findMarkdownSectionHeadingLine(lines, {
				blockId: "section_target",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "旧标题",
			}),
		).toBe(2);
		expect(stripSectionIdCommentLines(lines.join("\n"))).toBe("\n## 新标题\n\n正文");
	});
});
