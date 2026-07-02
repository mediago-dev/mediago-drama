import { describe, expect, it } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import {
	createSectionBlockId,
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

	it("only treats second-level headings as document sections", () => {
		const sections = listDocumentSections(
			document(
				[
					"<!-- section-id: section_episode -->",
					"# 第一集",
					"",
					"<!-- section-id: section_shot -->",
					"## 镜头 01",
					"",
					"### 镜头细节",
					"",
					"<!-- section-id: section_prop -->",
					"#### 道具细节",
					"",
					"## 镜头 02",
				].join("\n"),
			),
		);

		expect(sections).toEqual([
			{ blockId: "section_shot", level: 2, title: "镜头 01" },
			{ blockId: createSectionBlockId("doc-1", 2, 1, "镜头 02"), level: 2, title: "镜头 02" },
		]);
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

	it("keeps fallback section block ids stable for backend document context lookup", () => {
		expect(createSectionBlockId("story-doc", 2, 1, "第 01 组")).toBe("section-fpqbti");
		expect(createSectionBlockId("角色册 第一章", 1, 2, "林书彤")).toBe("section-mutyck");
		expect(createSectionBlockId("doc-1", 3, 1, "  视频   提示词  ")).toBe("section-uwtz0i");
		expect(createSectionBlockId("story-doc", 2, 3, "Chen Yuan Prompt")).toBe("section-s0hgoo");
	});
});
