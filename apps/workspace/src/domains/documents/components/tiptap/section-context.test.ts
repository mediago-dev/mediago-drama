import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { SectionIdAnchor } from "@/domains/documents/components/extensions/section-id-anchor";
import { findTopLevelBlockRangeByIndex } from "./ranges";
import { createMarkdownSectionContext, ensureMarkdownHeadingSectionId } from "./section-context";

describe("section context", () => {
	it("inserts a persisted section-id before opening section generation", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: "## 幻师\n\n正文",
			contentType: "markdown",
		});
		const headingRange = findTopLevelBlockRangeByIndex(editor.state.doc, 0);
		if (!headingRange) throw new Error("missing heading range");

		const nextRange = ensureMarkdownHeadingSectionId(editor, headingRange);
		if (!nextRange) throw new Error("missing ensured heading range");
		const section = createMarkdownSectionContext(editor, "doc-1", nextRange);

		expect(section?.blockId).toMatch(/^section_/);
		expect(editor.getMarkdown()).toMatch(/<!-- section-id: section_[A-Za-z0-9_-]+ -->/);
		expect(section?.prompt).not.toContain("section-id");

		editor.destroy();
	});

	it("uses the hovered heading level as the section boundary", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: [
				"# 第 01 组",
				"",
				"集摘要",
				"",
				"## 分镜 01",
				"",
				"动作 01",
				"",
				"### 镜头细节",
				"",
				"细节 01",
				"",
				"### 声音细节",
				"",
				"声音 01",
				"",
				"## 分镜 02",
				"",
				"动作 02",
				"",
				"# 第 02 组",
				"",
				"集摘要 02",
			].join("\n"),
			contentType: "markdown",
		});

		const episode = createMarkdownSectionContext(editor, "doc-1", headingRangeAt(editor, 0));
		expect(episode?.markdown).toContain("## 分镜 02");
		expect(episode?.markdown).not.toContain("# 第 02 组");

		const shot = createMarkdownSectionContext(editor, "doc-1", headingRangeAt(editor, 2));
		expect(shot?.markdown).toContain("### 镜头细节");
		expect(shot?.markdown).toContain("### 声音细节");
		expect(shot?.markdown).not.toContain("## 分镜 02");

		const detail = createMarkdownSectionContext(editor, "doc-1", headingRangeAt(editor, 4));
		expect(detail?.markdown).toContain("细节 01");
		expect(detail?.markdown).not.toContain("### 声音细节");

		editor.destroy();
	});

	it("preserves section body markdown in the generation prompt", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: [
				"## 沈闯（普通状态）",
				"",
				"**形象定位**：23岁东亚男性，现实青年。",
				"",
				"- 湿透落水状态",
				"- 生死压力下的紧绷表情",
				"",
				"### 标志性细节",
				"",
				"衣服滴水，眼神里带着强烈求生反应。",
			].join("\n"),
			contentType: "markdown",
		});

		const section = createMarkdownSectionContext(editor, "doc-1", headingRangeAt(editor, 0));

		expect(section?.prompt).toContain("**形象定位**");
		expect(section?.prompt).toContain("- 湿透落水状态");
		expect(section?.prompt).toContain("### 标志性细节");

		editor.destroy();
	});
});

const headingRangeAt = (editor: Editor, headingIndex: number) => {
	const range = findTopLevelBlockRangeByIndex(editor.state.doc, headingIndex);
	if (!range) throw new Error(`missing heading range at ${headingIndex}`);
	return range;
};
