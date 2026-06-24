import { describe, expect, it } from "vitest";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	compareDirectoryLabels,
	documentSidebarLabel,
	resolveDirectoryFilePath,
	resolveDirectoryFolderPath,
} from "./file-manager";

const makeFolder = (
	id: string,
	name: string,
	parentId: string | null = null,
	sortOrder = 0,
): DocumentFolder => ({
	id,
	name,
	parentId,
	sortOrder,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

const makeDocument = (
	id: string,
	title: string,
	folderId: string | null = null,
): MarkdownDocument => ({
	id,
	title,
	content: "",
	category: "screenplay",
	parentId: null,
	folderId,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-06-04T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const makeAsset = (id: string, filename: string, folderId: string | null = null): ProjectAsset => ({
	id,
	projectId: "project-a",
	kind: "text",
	filename,
	mimeType: "text/plain",
	sizeBytes: 16,
	url: `/api/v1/projects/project-a/assets/${id}/content`,
	folderId,
	sortOrder: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

describe("document sidebar labels", () => {
	it("shows the real on-disk filename stem so duplicate suffixes stay visible", () => {
		const document = { ...makeDocument("doc-1", "第一集道具"), filename: "第一集道具-2.md" };
		expect(documentSidebarLabel(document)).toBe("第一集道具-2");
	});

	it("uses the basename when the filename includes a folder path", () => {
		const document = { ...makeDocument("doc-2", "角色"), filename: "角色/第一集角色.md" };
		expect(documentSidebarLabel(document)).toBe("第一集角色");
	});

	it("falls back to the title when the backend did not provide a filename", () => {
		expect(documentSidebarLabel(makeDocument("doc-3", "回退标题"))).toBe("回退标题");
	});
});

describe("directory label sorting", () => {
	it("keeps the plain filename before duplicate suffixes", () => {
		expect(compareDirectoryLabels("第一集道具", "第一集道具-2")).toBeLessThan(0);
	});
});

describe("directory file manager paths", () => {
	it("resolves duplicate folder names with the backend suffix convention", () => {
		const folders = [
			makeFolder("folder-a", "参考"),
			makeFolder("folder-b", "深层:资料?", "folder-a"),
			makeFolder("folder-c", "深层:资料?", "folder-a", 1),
		];

		expect(
			resolveDirectoryFolderPath({
				folder: folders[2] as DocumentFolder,
				folders,
				workspaceDir: "/workspace/project-a",
			}),
		).toBe("/workspace/project-a/work/参考/深层-资料-2");
	});

	it("resolves duplicate document filenames in the same folder", () => {
		const folders = [makeFolder("folder-a", "参考")];
		const documents = [
			makeDocument("doc-a", "第一章", "folder-a"),
			makeDocument("doc-b", "第一章", "folder-a"),
		];

		expect(
			resolveDirectoryFilePath({
				documents,
				entry: {
					kind: "document",
					id: "doc-b",
					document: documents[1] as MarkdownDocument,
				},
				folders,
				workspaceDir: "/workspace/project-a",
			}),
		).toBe("/workspace/project-a/work/参考/第一章-2.md");
	});

	it("resolves asset files under the project work folder", () => {
		const folders = [makeFolder("folder-a", "参考")];
		const asset = makeAsset("asset-a", "notes.txt", "folder-a");

		expect(
			resolveDirectoryFilePath({
				documents: [],
				entry: {
					kind: "asset",
					id: asset.id,
					asset,
				},
				folders,
				workspaceDir: "/workspace/project-a",
			}),
		).toBe("/workspace/project-a/work/参考/notes.txt");
	});
});
