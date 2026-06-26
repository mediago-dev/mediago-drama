import { describe, expect, it } from "vitest";
import type { AgentReference } from "@/domains/agent/api/agent";
import { buildAgentDisplayMetadata, displayAttachmentFromReference } from "./display-attachments";

describe("agent display attachments", () => {
	it("builds display metadata for document references", () => {
		const metadata = buildAgentDisplayMetadata(
			[],
			[
				{
					kind: "document",
					documentId: "doc-1",
					title: "短剧剧本：《海鲜面：食神归来》.md",
					category: "screenplay",
				},
			],
		);

		expect(metadata?.displayAttachments).toEqual([
			{
				id: "doc-1",
				kind: "file",
				mimeType: "文档",
				name: "短剧剧本：《海鲜面：食神归来》.md",
				url: undefined,
			},
		]);
	});

	it("labels section references as document fragments", () => {
		expect(
			displayAttachmentFromReference({
				kind: "section",
				documentId: "doc-1",
				blockId: "scene-1",
				title: "第一场 海鲜面摊",
			}),
		).toEqual({
			id: "doc-1:scene-1",
			kind: "file",
			mimeType: "文档片段",
			name: "第一场 海鲜面摊",
			url: undefined,
		});
	});

	it("keeps uploaded attachments before duplicate references", () => {
		const assetReference: AgentReference = {
			kind: "asset",
			documentId: "asset-1",
			assetId: "asset-1",
			assetKind: "text",
			mimeType: "text/plain",
			title: "完美世界.txt",
			category: "reference",
			url: "/api/v1/projects/project-1/assets/asset-1/content",
		};

		const metadata = buildAgentDisplayMetadata(
			[
				{
					id: "local-file-1",
					kind: "file",
					mimeType: "text/plain",
					name: "完美世界.txt",
					size: 14_469_529,
				},
			],
			[assetReference],
		);

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
	});
});
