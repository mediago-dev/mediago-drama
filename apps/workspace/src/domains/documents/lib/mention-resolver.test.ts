import { describe, expect, it } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { createSectionBlockId } from "./sections";
import {
	mediaAssetIdFromGeneratedSource,
	mentionHrefFromReference,
	mentionMarkdownFromReference,
	parseMentionHref,
	resolveMentionPayload,
} from "./mention-resolver";

describe("mention resolver", () => {
	it("serializes document and section mentions with stable IDs only", () => {
		expect(
			mentionHrefFromReference({
				blockId: "section_gate",
				category: "scene",
				documentId: "scene-doc",
				kind: "section",
				title: "湖大正校门口",
			}),
		).toBe("mention://scene-doc/section_gate");
		expect(
			mentionMarkdownFromReference({
				category: "character",
				documentId: "character-doc",
				kind: "document",
				title: "陈远",
			}),
		).toBe("@[陈远](mention://character-doc)");
	});

	it("parses legacy query params but normalizes back to stable hrefs", () => {
		const reference = parseMentionHref(
			"mention://scene-doc/section_gate?kind=section&category=scene",
			"湖大正校门口",
		);

		expect(reference).toMatchObject({
			blockId: "section_gate",
			category: "scene",
			documentId: "scene-doc",
			kind: "section",
			title: "湖大正校门口",
		});
		expect(reference ? mentionMarkdownFromReference(reference) : "").toBe(
			"@[湖大正校门口](mention://scene-doc/section_gate)",
		);
	});

	it("extracts media asset ids from current and legacy content urls", () => {
		expect(mediaAssetIdFromGeneratedSource("/api/v1/media-assets/image-1/content")).toBe("image-1");
		expect(
			mediaAssetIdFromGeneratedSource(
				"http://127.0.0.1:48273/api/v1/projects/project-a/media-assets/image%202/content",
			),
		).toBe("image 2");
		expect(mediaAssetIdFromGeneratedSource("/api/media/assets/image-3/content")).toBe("image-3");
	});

	it("resolves a legacy document mention to its only section", () => {
		const document = createMarkdownDocument({
			id: "character-doc",
			title: "林书彤",
			category: "character",
			content: [
				"## 林书彤",
				"",
				"21 岁女大学生。",
				"",
				"![林书彤图](/api/v1/media-assets/lin-image/content)",
			].join("\n"),
		});

		const result = resolveMentionPayload(
			{
				documentId: "character-doc",
				kind: "document",
				title: "林书彤",
			},
			[document],
		);

		expect(result.status).toBe("ok");
		expect(result.reference).toMatchObject({
			blockId: createSectionBlockId("character-doc", 2, 1, "林书彤"),
			category: "character",
			documentId: "character-doc",
			kind: "section",
			title: "林书彤",
		});
		expect(result.text).toContain("21 岁女大学生。");
		expect(result.images).toEqual([
			{
				mediaAssetId: "lin-image",
				url: "/api/v1/media-assets/lin-image/content",
			},
		]);
	});

	it("does not resolve a legacy document mention to a first-level heading", () => {
		const document = createMarkdownDocument({
			id: "character-doc",
			title: "林书彤",
			category: "character",
			content: [
				"# 林书彤",
				"",
				"21 岁女大学生。",
				"",
				"![林书彤图](/api/v1/media-assets/lin-image/content)",
			].join("\n"),
		});

		const result = resolveMentionPayload(
			{
				documentId: "character-doc",
				kind: "document",
				title: "林书彤",
			},
			[document],
		);

		expect(result.status).toBe("ok");
		expect(result.reference).toMatchObject({
			category: "character",
			documentId: "character-doc",
			kind: "document",
			title: "林书彤",
		});
		expect(result.reference.kind).toBe("document");
	});

	it("keeps a legacy document mention as document when the target has no sections", () => {
		const document = createMarkdownDocument({
			id: "note-doc",
			title: "散文设定",
			category: "reference",
			content: "没有标题的设定正文。",
		});

		const result = resolveMentionPayload(
			{
				documentId: "note-doc",
				kind: "document",
				title: "散文设定",
			},
			[document],
		);

		expect(result.status).toBe("ok");
		expect(result.reference).toMatchObject({
			documentId: "note-doc",
			kind: "document",
			title: "散文设定",
		});
		expect(result.text).toBe("没有标题的设定正文。");
	});

	it("keeps a legacy document mention as document when the target has multiple sections", () => {
		const document = createMarkdownDocument({
			id: "characters-doc",
			title: "角色册 第一章",
			category: "character",
			content: [
				"# 角色册 第一章",
				"",
				"## 陈远",
				"",
				"陈远正文。",
				"",
				"## 林书彤",
				"",
				"林书彤正文。",
			].join("\n"),
		});

		const result = resolveMentionPayload(
			{
				documentId: "characters-doc",
				kind: "document",
				title: "林书彤",
			},
			[document],
		);

		expect(result.status).toBe("ok");
		expect(result.reference).toMatchObject({
			category: "character",
			documentId: "characters-doc",
			kind: "document",
			title: "林书彤",
		});
		expect(result.text).toContain("陈远正文。");
		expect(result.text).toContain("林书彤正文。");
	});
});

const createMarkdownDocument = (
	overrides: Pick<MarkdownDocument, "content" | "id" | "title"> & Partial<MarkdownDocument>,
): MarkdownDocument => ({
	category: "reference",
	comments: [],
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	updatedAt: "2026-01-01T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
});
