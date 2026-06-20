import { describe, expect, it } from "vitest";
import type { MarkdownSectionIdentity } from "@/domains/documents/lib/editor-registry";
import { sectionIdBeforeHeadingLine } from "@/domains/documents/lib/sections";
import {
	appendSectionMediaMarkdown,
	removeSectionMediaMarkdown,
	sectionMediaFromMarkdownLine,
	sectionMediaSourceFromLine,
} from "./section-media";

describe("section media markdown", () => {
	const section: MarkdownSectionIdentity = {
		blockId: "section_voice",
		documentId: "doc-1",
		headingLevel: 2,
		headingOccurrence: 1,
		headingText: "旁白",
	};

	it("appends and removes section audio links by source", () => {
		const markdown = ["<!-- section-id: section_voice -->", "## 旁白", "", "台词。"].join("\n");

		const appended = appendSectionMediaMarkdown(markdown, section, {
			kind: "audio",
			src: "/api/v1/media-assets/audio-1/content",
			title: "旁白",
		});

		expect(appended?.changed).toBe(true);
		expect(appended?.markdown).toContain(
			"[章节音频：旁白](</api/v1/media-assets/audio-1/content>)",
		);
		expect(
			sectionMediaSourceFromLine(
				"[章节音频：旁白](</api/v1/media-assets/audio-1/content>)",
				"audio",
			),
		).toBe("/api/v1/media-assets/audio-1/content");

		const removed = removeSectionMediaMarkdown(appended?.markdown ?? "", section, {
			kind: "audio",
			src: "/api/v1/media-assets/audio-1/content",
			title: "旁白",
		});

		expect(removed?.changed).toBe(true);
		expect(removed?.markdown).toBe(markdown);
	});

	it("keeps the next section id attached to its heading when inserting a video", () => {
		const markdown = [
			"<!-- section-id: section_voice -->",
			"## 旁白",
			"",
			"第一段正文",
			"",
			"<!-- section-id: section_next -->",
			"## 下一节",
			"",
			"第二段正文",
		].join("\n");

		const result = appendSectionMediaMarkdown(markdown, section, {
			kind: "video",
			src: "/api/v1/media-assets/video-1/content",
			title: "旁白",
		});
		const lines = result?.markdown.split("\n") ?? [];
		const nextHeadingIndex = lines.findIndex((line) => line === "## 下一节");

		expect(result?.changed).toBe(true);
		expect(result?.markdown).toContain("[章节视频：旁白](</api/v1/media-assets/video-1/content>)");
		expect(nextHeadingIndex).toBeGreaterThan(0);
		expect(sectionIdBeforeHeadingLine(lines, nextHeadingIndex)).toBe("section_next");
	});

	it("does not treat bare section media labels as selected media", () => {
		expect(
			sectionMediaFromMarkdownLine("[章节音频](</api/v1/media-assets/audio-1/content>)"),
		).toBeNull();
		expect(
			sectionMediaFromMarkdownLine("[章节视频：](</api/v1/media-assets/video-1/content>)"),
		).toBeNull();
	});

	it("ignores section media links without a source", () => {
		expect(sectionMediaFromMarkdownLine("[章节音频：旁白](<>)")).toBeNull();
		expect(sectionMediaFromMarkdownLine("[章节视频：旁白]()")).toBeNull();

		const markdown = ["<!-- section-id: section_voice -->", "## 旁白", "", "台词。"].join("\n");
		expect(
			appendSectionMediaMarkdown(markdown, section, {
				kind: "audio",
				src: "",
				title: "旁白",
			}),
		).toBeNull();
	});
});
