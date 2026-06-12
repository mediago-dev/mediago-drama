import { describe, expect, it } from "vitest";
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { buildDirectoryTree, previewForPayload } from "./helpers";

const makeDocument = (id: string, title: string, sortOrder: number): MarkdownDocument => ({
	id,
	title,
	content: "",
	category: "screenplay",
	parentId: null,
	folderId: null,
	sortOrder,
	version: 1,
	updatedAt: "2026-06-04T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const makeAsset = (id: string, filename: string, sortOrder: number): ProjectAsset => ({
	id,
	projectId: "project-a",
	kind: "text",
	filename,
	mimeType: "text/plain",
	sizeBytes: 16,
	url: `/api/v1/projects/project-a/assets/${id}/content`,
	folderId: null,
	sortOrder,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

describe("directory tree helpers", () => {
	it("sorts same-level files by title instead of sortOrder", () => {
		const tree = buildDirectoryTree(
			[] satisfies DocumentFolder[],
			[makeDocument("doc-b", "B 文档", 0), makeDocument("doc-a", "A 文档", 99)],
			[makeAsset("asset-c", "C 素材.txt", -1)],
		);

		expect(tree.files.map((file) => file.title)).toEqual(["A 文档", "B 文档", "C 素材.txt"]);
	});

	it("uses the document category icon for drag previews", () => {
		const preview = previewForPayload(
			{ kind: "document", id: "doc-a" },
			[],
			[makeDocument("doc-a", "A 文档", 0)],
			[],
		);

		expect(preview?.icon).toBe(documentCategoryDescriptorMap.screenplay.icon);
	});
});
