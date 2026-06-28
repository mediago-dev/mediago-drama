import { describe, expect, it } from "vitest";
import { createSectionBlockId } from "@/domains/documents/lib/sections";
import type { MarkdownDocument } from "@/domains/documents/stores";
import type { EpisodeCanvasLane, EpisodeCanvasNode } from "./canvas-graph";
import { createReferenceImageGenerationSection } from "./canvas-generation";

const activeDocument: MarkdownDocument = {
	category: "storyboard",
	comments: [],
	content: "# 分镜",
	id: "doc-1",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: "第一章分镜",
	updatedAt: "2026-06-21T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
};

const referencedSectionBlockId = createSectionBlockId("character-1", 1, 1, "林书彤");
const characterBookLinBlockId = createSectionBlockId("character-book-1", 2, 1, "林书彤（女主）");
const characterBookWithIdsLegacyLinBlockId = createSectionBlockId(
	"character-book-with-ids",
	2,
	1,
	"林书彤",
);
const characterBookWithIdsCurrentLinBlockId = "section_lin_current";

const referencedDocument: MarkdownDocument = {
	category: "character",
	comments: [],
	content:
		"# 林书彤\n\n林书彤，21岁女大学生，清纯克制，偏甜美系建模。\n\n![角色图](/media/lin.png)",
	id: "character-1",
	isDirty: false,
	parentId: null,
	sortOrder: 1,
	title: "林书彤",
	updatedAt: "2026-06-21T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
};

const characterBookDocument: MarkdownDocument = {
	category: "character",
	comments: [],
	content: [
		"# 角色册 第一章",
		"",
		"视觉风格：3DCG动漫",
		"",
		"## 陈远",
		"",
		"陈远，21岁男大学生，身高179cm，63kg。",
		"",
		"## 林书彤（女主）",
		"",
		"林书彤",
		"形象定位：21岁女大学生，身高163cm，48kg。班花级别颜值，外表清纯实则心机绿茶。",
	].join("\n"),
	id: "character-book-1",
	isDirty: false,
	parentId: null,
	sortOrder: 2,
	title: "角色册 第一章",
	updatedAt: "2026-06-21T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
};

const characterBookWithIdsDocument: MarkdownDocument = {
	category: "character",
	comments: [],
	content: [
		"# 角色册 第一章",
		"",
		"<!-- section-id: section_chen_current -->",
		"## 陈远",
		"",
		"陈远，21岁男大学生，身高179cm，63kg。",
		"",
		`<!-- section-id: ${characterBookWithIdsCurrentLinBlockId} -->`,
		"## 林书彤",
		"",
		"林书彤",
		"形象定位：21岁女大学生，身高163cm，48kg。班花级别颜值，外表清纯实则心机绿茶。",
	].join("\n"),
	id: "character-book-with-ids",
	isDirty: false,
	parentId: null,
	sortOrder: 3,
	title: "角色册 第一章",
	updatedAt: "2026-06-21T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
};

const lane: EpisodeCanvasLane = {
	clipId: "clip-1",
	end: 7,
	headingLevel: 2,
	headingOccurrence: 1,
	id: "lane-clip-1",
	index: 0,
	references: [],
	shots: [],
	sourceMarkdown: "## 第 01 组\n\n当前分镜 prompt 不应该进入引用生成。",
	start: 0,
	title: "第 01 组",
};

const referenceImageNode: EpisodeCanvasNode = {
	data: {
		body: "从提示词生成素材图。",
		canGenerateReferenceImage: true,
		clipId: "clip-1",
		laneId: lane.id,
		laneIndex: 0,
		laneTitle: lane.title,
		nodeType: "reference-image",
		reference: {
			agentReference: {
				documentId: "character-1",
				kind: "document",
				title: "林书彤",
			},
			category: "character",
			key: "document:character-1",
			status: "ok",
			summary: "林书彤，21岁女大学生，清纯克制，偏甜美系建模。",
			title: "林书彤",
		},
		status: "draft",
		subtitle: "图片生成",
		title: "林书彤",
	},
	id: "node-lane-clip-1-reference-image-1-document-character-1",
	position: { x: 0, y: 0 },
	type: "reference-image",
};

describe("createReferenceImageGenerationSection", () => {
	it("reuses the referenced section identity so generation history is shared", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument, referencedDocument],
			node: {
				...referenceImageNode,
				data: {
					...referenceImageNode.data,
					reference: {
						...referenceImageNode.data.reference!,
						agentReference: {
							blockId: referencedSectionBlockId,
							documentId: referencedDocument.id,
							kind: "section",
							title: "林书彤",
						},
					},
				},
			},
		});

		expect(section).toMatchObject({
			blockId: referencedSectionBlockId,
			documentId: referencedDocument.id,
			headingText: "林书彤",
		});
		expect(section?.prompt).toContain("林书彤，21岁女大学生");
		expect(section?.prompt).not.toContain("当前分镜");
	});

	it("maps a legacy single-section document mention to its document section", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument, referencedDocument],
			node: referenceImageNode,
		});

		expect(section).toMatchObject({
			blockId: referencedSectionBlockId,
			documentId: referencedDocument.id,
			headingText: "林书彤",
		});
		expect(section?.prompt).not.toContain("当前分镜");
	});

	it("does not create a synthetic generation target from a title-only document mention", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument, characterBookDocument],
			node: {
				...referenceImageNode,
				data: {
					...referenceImageNode.data,
					reference: {
						agentReference: {
							documentId: characterBookDocument.id,
							kind: "document",
							title: "林书彤",
						},
						category: "character",
						key: "document:character-book-1",
						status: "ok",
						summary: "林书彤 形象定位：21岁女大学生，身高163cm，48kg。",
						title: "林书彤",
					},
				},
			},
		});

		expect(section).toBeNull();
	});

	it("uses the exact section id when the reference points at a later heading", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument, characterBookDocument],
			node: {
				...referenceImageNode,
				data: {
					...referenceImageNode.data,
					reference: {
						agentReference: {
							blockId: characterBookLinBlockId,
							documentId: characterBookDocument.id,
							kind: "section",
							title: "林书彤",
						},
						category: "character",
						key: `document:character-book-1:${characterBookLinBlockId}`,
						status: "ok",
						summary: "林书彤 形象定位：21岁女大学生，身高163cm，48kg。",
						title: "林书彤",
					},
				},
			},
		});

		expect(section).toMatchObject({
			blockId: characterBookLinBlockId,
			documentId: characterBookDocument.id,
			headingText: "林书彤（女主）",
		});
		expect(section?.prompt).toContain("林书彤");
		expect(section?.prompt).toContain("21岁女大学生");
		expect(section?.prompt).not.toContain("陈远");
		expect(section?.prompt).not.toContain("视觉风格");
	});

	it("maps a legacy generated section id to the current explicit document section id", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument, characterBookWithIdsDocument],
			node: {
				...referenceImageNode,
				data: {
					...referenceImageNode.data,
					reference: {
						agentReference: {
							blockId: characterBookWithIdsLegacyLinBlockId,
							documentId: characterBookWithIdsDocument.id,
							kind: "section",
							title: "林书彤",
						},
						category: "character",
						key: `document:character-book-with-ids:${characterBookWithIdsLegacyLinBlockId}`,
						status: "ok",
						summary: "林书彤 形象定位：21岁女大学生，身高163cm，48kg。",
						title: "林书彤",
					},
				},
			},
		});

		expect(section).toMatchObject({
			blockId: characterBookWithIdsCurrentLinBlockId,
			documentId: characterBookWithIdsDocument.id,
			headingText: "林书彤",
		});
		expect(section?.prompt).toContain("林书彤");
		expect(section?.prompt).toContain("21岁女大学生");
		expect(section?.prompt).not.toContain("陈远");
	});

	it("does not create context for non-reference-image or placeholder nodes", () => {
		expect(
			createReferenceImageGenerationSection({
				documents: [activeDocument, referencedDocument],
				node: { ...referenceImageNode, type: "reference-prompt" },
			}),
		).toBeNull();
		expect(
			createReferenceImageGenerationSection({
				documents: [activeDocument, referencedDocument],
				node: {
					...referenceImageNode,
					data: {
						...referenceImageNode.data,
						reference: {
							...referenceImageNode.data.reference!,
							status: "placeholder",
						},
					},
				},
			}),
		).toBeNull();
	});

	it("does not create a synthetic generation target when the referenced document is unavailable", () => {
		const section = createReferenceImageGenerationSection({
			documents: [activeDocument],
			node: referenceImageNode,
		});

		expect(section).toBeNull();
	});
});
