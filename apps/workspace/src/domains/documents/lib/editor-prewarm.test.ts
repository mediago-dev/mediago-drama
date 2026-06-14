import { describe, expect, it } from "vitest";
import { selectDocumentsForEditorPrewarm } from "./editor-prewarm";
import type { MarkdownDocument } from "@/domains/documents/stores";

const makeDocument = (
	id: string,
	content: string,
	options: Partial<MarkdownDocument> = {},
): MarkdownDocument => ({
	id,
	title: id,
	content,
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	tags: [],
	version: 1,
	updatedAt: "2026-06-15T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
	...options,
});

describe("selectDocumentsForEditorPrewarm", () => {
	it("prioritizes the active document, storyboards, and longer content", () => {
		const documents = [
			makeDocument("overview", "# overview"),
			makeDocument("short", "短内容"),
			makeDocument("long", "x".repeat(100)),
			makeDocument("storyboard", "y".repeat(10), { category: "storyboard" }),
			makeDocument("active", "z".repeat(5)),
		];

		expect(selectDocumentsForEditorPrewarm(documents, "active", 3).map((item) => item.id)).toEqual([
			"active",
			"storyboard",
			"long",
		]);
	});

	it("skips blank documents", () => {
		const documents = [makeDocument("blank", "   "), makeDocument("ready", "正文")];

		expect(selectDocumentsForEditorPrewarm(documents, "", 3).map((item) => item.id)).toEqual([
			"ready",
		]);
	});
});
