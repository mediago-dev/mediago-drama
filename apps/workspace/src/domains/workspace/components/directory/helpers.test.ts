import { describe, expect, it } from "vitest";
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { buildDirectoryTree, isSidebarVisibleProjectAsset, previewForPayload } from "./helpers";

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

const makeAsset = (filename: string, mimeType: string): ProjectAsset => ({
	id: `asset-${filename}`,
	projectId: "project-a",
	kind: "text",
	filename,
	mimeType,
	sizeBytes: 16,
	url: `/api/v1/projects/project-a/assets/${filename}/content`,
	folderId: null,
	sortOrder: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

describe("directory tree helpers", () => {
	it("sorts same-level documents by real filename stem", () => {
		const tree = buildDirectoryTree(
			[] satisfies DocumentFolder[],
			[
				{ ...makeDocument("doc-b", "第一集道具", 0), filename: "第一集道具-2.md" },
				{ ...makeDocument("doc-a", "第一集道具", 99), filename: "第一集道具.md" },
			],
			[],
		);

		expect(tree.files.map((file) => file.title)).toEqual(["第一集道具", "第一集道具-2"]);
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

	it("hides markdown project assets from the sidebar", () => {
		expect(isSidebarVisibleProjectAsset(makeAsset("资料.md", "text/plain"))).toBe(false);
		expect(isSidebarVisibleProjectAsset(makeAsset("资料.txt", "text/markdown"))).toBe(false);
		expect(isSidebarVisibleProjectAsset(makeAsset("资料.txt", "text/plain"))).toBe(true);
	});
});
