import { describe, expect, it } from "vitest";
import {
	findFirstOpenComment,
	firstEditableDocumentId,
	getOpenComments,
	getProjectScopedDocuments,
	getResolvedComments,
	isStoryboardWorkbenchDocument,
	selectEditableDocument,
	selectStoryboardWorkbenchDocument,
} from "@/domains/documents/lib/filters";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";

const comment = (id: string, resolved: boolean): DocumentComment => ({
	id,
	resolved,
	anchorText: id,
	anchor: { quote: id, contextBefore: "", contextAfter: "" },
	body: id,
	createdAt: "2026-01-01T00:00:00.000Z",
});

const document = (
	id: string,
	category: MarkdownDocument["category"] = "screenplay",
	workbenchDraft: MarkdownDocument["workbenchDraft"] = null,
): MarkdownDocument => ({
	id,
	title: id,
	content: "",
	category,
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-01-01T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft,
});

describe("document filters", () => {
	it("splits comment lists by resolved state", () => {
		const comments = [comment("open", false), comment("done", true)];

		expect(getOpenComments(comments).map((item) => item.id)).toEqual(["open"]);
		expect(getResolvedComments(comments).map((item) => item.id)).toEqual(["done"]);
		expect(findFirstOpenComment(comments)?.id).toBe("open");
	});

	it("selects editable documents before overview documents", () => {
		const documents = [document("overview", "overview"), document("draft")];

		expect(firstEditableDocumentId(documents)).toBe("draft");
		expect(selectEditableDocument(documents, "missing")?.id).toBe("draft");
	});

	it("selects storyboard workbench documents with active-id priority", () => {
		const first = document("storyboard-a", "storyboard", {
			id: "draft-a",
			documentId: "storyboard-a",
			title: "A",
			kind: "episode",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const second = document("storyboard-b", "storyboard", {
			id: "draft-b",
			documentId: "storyboard-b",
			title: "B",
			kind: "episode",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(isStoryboardWorkbenchDocument(first)).toBe(true);
		expect(selectStoryboardWorkbenchDocument([first, second], "storyboard-b")?.id).toBe(
			"storyboard-b",
		);
	});

	it("returns documents only for the loaded project", () => {
		const documents = [document("draft")];

		expect(getProjectScopedDocuments(documents, "project-a", "project-a")).toHaveLength(1);
		expect(getProjectScopedDocuments(documents, "project-a", "project-b")).toHaveLength(0);
	});
});
