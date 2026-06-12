import { describe, expect, it } from "vitest";
import {
	applyDocumentOperationsToDocument,
	createDocumentOperation,
	createTextAnchor,
	findTextAnchorIndex,
	type OperationDocumentLike,
	type ReplaceTextOperation,
} from "@/domains/documents/lib/operations";

const createDocument = (content: string): OperationDocumentLike => ({
	comments: [],
	content,
	title: "剧本文档",
});

describe("document operations", () => {
	it("replaces anchored text and records the applied operation", () => {
		const document = createDocument("# 开场\n\n小明走进房间。\n");
		const anchor = createTextAnchor(document.content, "小明走进房间。");
		const operation = createDocumentOperation<ReplaceTextOperation>({
			type: "replace_text",
			summary: "调整动作描写",
			target: { anchor },
			payload: { replacement: "小明推门进入房间。" },
			id: "op-replace",
			createdAt: "2026-05-30T00:00:00.000Z",
		});

		const result = applyDocumentOperationsToDocument(document, [operation]);

		expect(result.applied).toBe(1);
		expect(result.appliedOperations).toEqual([operation]);
		expect(result.document.content).toContain("小明推门进入房间。");
		expect(result.document.content).not.toContain("小明走进房间。");
	});

	it("leaves the document unchanged when an anchor cannot be found", () => {
		const document = createDocument("# 开场\n\n小明走进房间。\n");
		const operation = createDocumentOperation<ReplaceTextOperation>({
			type: "replace_text",
			summary: "尝试替换不存在的文本",
			target: {
				anchor: {
					quote: "不存在的句子。",
					contextBefore: "",
					contextAfter: "",
				},
			},
			payload: { replacement: "新句子。" },
			id: "op-miss",
			createdAt: "2026-05-30T00:00:00.000Z",
		});

		const result = applyDocumentOperationsToDocument(document, [operation]);

		expect(result.applied).toBe(0);
		expect(result.document).toEqual(document);
	});

	it("uses anchor context to locate repeated quote text", () => {
		const content = "第一段重复。\n\n第二段重复。";
		const anchor = {
			quote: "重复",
			contextBefore: "第一段重复。\n\n第二段",
			contextAfter: "。",
		};

		expect(findTextAnchorIndex(content, anchor)).toBe(content.lastIndexOf("重复"));
		const renderedText = "第一段重复。\n第二段重复。";
		expect(findTextAnchorIndex(renderedText, anchor)).toBe(renderedText.lastIndexOf("重复"));
	});
});
