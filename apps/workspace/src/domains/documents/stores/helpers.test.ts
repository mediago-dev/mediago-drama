import { describe, expect, it } from "vitest";
import { normalizeDocumentCategoryValue, normalizeDocuments } from "./helpers";
import type { MarkdownDocument } from "./types";

const document = (overrides: Partial<MarkdownDocument> = {}): MarkdownDocument => ({
	id: "doc-a",
	title: "文档",
	content: "# 文档\n",
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-06-01T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
	...overrides,
});

describe("document store helpers", () => {
	it("normalizes the legacy source-material category to reference", () => {
		expect(normalizeDocumentCategoryValue(" source-material ")).toBe("reference");

		const [normalized] = normalizeDocuments([
			document({ category: "source-material" as unknown as MarkdownDocument["category"] }),
		]);

		expect(normalized?.category).toBe("reference");
	});
});
