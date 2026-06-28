import { describe, expect, it } from "vitest";
import {
	appendSecondLevelHeading,
	mentionCreateLabelForCategory,
	normalizeMentionSectionTitle,
} from "./mention-section-create";

describe("mention section create helpers", () => {
	it("labels creation actions by document category", () => {
		expect(mentionCreateLabelForCategory("character")).toBe("新增角色");
		expect(mentionCreateLabelForCategory("scene")).toBe("新增场景");
		expect(mentionCreateLabelForCategory("prop")).toBe("新增道具");
		expect(mentionCreateLabelForCategory(undefined)).toBe("新增节点");
	});

	it("normalizes user-provided section names", () => {
		expect(normalizeMentionSectionTitle("  ## 顾依依\n十年前  ")).toBe("顾依依 十年前");
		expect(normalizeMentionSectionTitle(" \n ")).toBe("");
	});

	it("appends a level-2 heading at the end of markdown content", () => {
		expect(
			appendSecondLevelHeading("# 角色设定\n\n## 李虎\n正文", "顾依依", {
				sectionId: "section_guyiyi",
			}),
		).toBe("# 角色设定\n\n## 李虎\n正文\n\n<!-- section-id: section_guyiyi -->\n## 顾依依\n");
		expect(appendSecondLevelHeading("", "顾依依", { sectionId: "section_guyiyi" })).toBe(
			"<!-- section-id: section_guyiyi -->\n## 顾依依\n",
		);
	});

	it("generates a unique section id when appending a heading", () => {
		const content = appendSecondLevelHeading(
			"<!-- section-id: section_existing -->\n## 李虎",
			"顾依依",
		);

		expect(content).toContain("<!-- section-id: section_");
		expect(content).toContain("## 顾依依");
		expect(content).not.toContain("<!-- section-id: section_existing -->\n## 顾依依");
	});
});
