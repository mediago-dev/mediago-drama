import { describe, expect, it } from "vitest";
import { buildAgentDisplayMetadata } from "./display-attachments";

describe("agent display attachments", () => {
	it("builds attachment cards from uploaded files only", () => {
		const metadata = buildAgentDisplayMetadata([
			{
				id: "local-file-1",
				kind: "file",
				mimeType: "text/plain",
				name: "完美世界.txt",
				size: 14_469_529,
			},
		]);

		expect(metadata?.displayAttachments).toEqual([
			{
				id: "local-file-1",
				kind: "file",
				mimeType: "text/plain",
				name: "完美世界.txt",
				size: 14_469_529,
				url: undefined,
			},
		]);
		expect(metadata?.displaySegments).toBeUndefined();
	});

	it("keeps mention and skill chips as display segments", () => {
		const metadata = buildAgentDisplayMetadata(
			[],
			[
				{ type: "skill", name: "screenplay-writer", title: "剧本写作" },
				{ type: "text", text: " 理解一下这个文本" },
				{ type: "mention", title: "角色档案", category: "character", kind: "document" },
			],
		);

		expect(metadata?.displayAttachments).toBeUndefined();
		expect(metadata?.displaySegments).toEqual([
			{ type: "skill", name: "screenplay-writer", title: "剧本写作" },
			{ type: "text", text: " 理解一下这个文本" },
			{ type: "mention", title: "角色档案", category: "character", kind: "document" },
		]);
	});

	it("omits segments made of plain text only", () => {
		expect(buildAgentDisplayMetadata([], [{ type: "text", text: "你好" }])).toBeUndefined();
	});

	it("keeps thumbnail cards for @-mentioned image assets", () => {
		const metadata = buildAgentDisplayMetadata(
			[],
			[{ type: "mention", title: "分镜草图.png", kind: "asset" }],
			[
				{
					kind: "asset",
					documentId: "asset-1",
					assetId: "asset-1",
					assetKind: "image",
					mimeType: "image/png",
					title: "分镜草图.png",
					url: "/api/v1/projects/project-1/assets/asset-1/content",
				},
			],
		);

		expect(metadata?.displayAttachments).toEqual([
			{
				id: "asset-1",
				kind: "image",
				mimeType: "image/png",
				name: "分镜草图.png",
				url: "/api/v1/projects/project-1/assets/asset-1/content",
			},
		]);
	});

	it("does not turn non-image mentions into cards", () => {
		const metadata = buildAgentDisplayMetadata(
			[],
			[{ type: "mention", title: "角色档案", kind: "document" }],
			[{ kind: "document", documentId: "doc-1", title: "角色档案", category: "character" }],
		);

		expect(metadata?.displayAttachments).toBeUndefined();
		expect(metadata?.displaySegments).toHaveLength(1);
	});

	it("deduplicates identical uploaded files", () => {
		const attachment = {
			kind: "file",
			mimeType: "text/plain",
			name: "完美世界.txt",
		};
		const metadata = buildAgentDisplayMetadata([attachment, { ...attachment }]);

		expect(metadata?.displayAttachments).toHaveLength(1);
	});
});
