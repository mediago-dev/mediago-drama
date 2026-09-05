import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores/types";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { selectLatestChatScriptDocument } from "./latest-script-document";

const document = (overrides: Partial<MarkdownDocument>): MarkdownDocument => ({
	id: "script-v1",
	title: "《月亮准时到家》60秒剧本 V01",
	filename: "月亮准时到家-60秒剧本-V01.md",
	content: "V01 全文",
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-08-24T10:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
	...overrides,
});

const assistant = (content: string, createdAt: string): AgentMessage => ({
	id: createdAt,
	role: "assistant",
	kind: "message",
	phase: "final_answer",
	content,
	createdAt,
});

describe("selectLatestChatScriptDocument", () => {
	it("reads the full document linked by the latest assistant reply", () => {
		const v1 = document({});
		const v2 = document({
			id: "script-v2",
			title: "《月亮准时到家》60秒剧本 V02",
			filename: "月亮准时到家-60秒剧本-V02.md",
			content: "V02 完整脚本正文",
			version: 2,
		});
		const messages = [
			assistant("旧版：[《月亮准时到家》60秒剧本 V01](月亮准时到家-60秒剧本-V01.md)", "1"),
			assistant("已更新为 V02：[《月亮准时到家》60秒剧本 V02](月亮准时到家-60秒剧本-V02.md)", "2"),
		];
		expect(selectLatestChatScriptDocument(messages, [v1, v2])?.content).toBe("V02 完整脚本正文");
	});

	it("falls back to the newest screenplay document instead of an assistant summary", () => {
		const newest = document({
			id: "latest",
			title: "广告剧本 V03",
			content: "V03 完整正文",
			version: 3,
		});
		expect(
			selectLatestChatScriptDocument(
				[assistant("一句话摘要，不是脚本正文。", "3")],
				[document({}), newest],
			)?.content,
		).toBe("V03 完整正文");
	});

	it("accepts a linked script document with a generic category and title", () => {
		const linked = document({
			id: "moon-home",
			title: "月亮准时到家",
			filename: "月亮准时到家.md",
			category: "overview",
			content: "# 月亮准时到家\n\n完整六场剧本正文",
		});
		const message = assistant(
			"已更新为 V02：[《月亮准时到家》60秒剧本](/workspace/月亮准时到家.md)",
			"4",
		);
		expect(selectLatestChatScriptDocument([message], [linked])?.content).toContain(
			"完整六场剧本正文",
		);
	});
});
