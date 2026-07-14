import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { adaptAgentMessagesToTurnItems } from "./agent-thread-adapter";

const message = (patch: Partial<AgentMessage> = {}): AgentMessage => ({
	id: patch.id ?? "message-1",
	role: patch.role ?? "assistant",
	content: patch.content ?? "内容",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt ?? "2026-07-14T08:00:00.000Z",
	itemId: patch.itemId,
	turnId: patch.turnId,
	phase: patch.phase,
	title: patch.title,
	metadata: patch.metadata,
});

describe("agent thread legacy adapter", () => {
	it("uses explicit turn, item, and phase semantics before legacy inference", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "user-record", itemId: "user-item", turnId: "turn-1", role: "user" }),
			message({
				id: "comment-record",
				itemId: "comment-item",
				turnId: "turn-1",
				phase: "commentary",
			}),
			message({
				id: "tool-record",
				itemId: "tool-item",
				turnId: "turn-1",
				kind: "tool",
			}),
			message({
				id: "final-record",
				itemId: "final-item",
				turnId: "turn-1",
				phase: "final_answer",
			}),
			message({
				id: "form-record",
				itemId: "form-item",
				turnId: "turn-1",
				metadata: {
					form: { selectionId: "selection-1", title: "确认参数", fields: [] },
				},
			}),
		]);

		expect(items.map(({ turnId, itemId, lane }) => ({ turnId, itemId, lane }))).toEqual([
			{ turnId: "turn-1", itemId: "user-item", lane: "user" },
			{ turnId: "turn-1", itemId: "comment-item", lane: "process" },
			{ turnId: "turn-1", itemId: "tool-item", lane: "process" },
			{ turnId: "turn-1", itemId: "final-item", lane: "final" },
			{ turnId: "turn-1", itemId: "form-item", lane: "interaction" },
		]);
	});

	it("recovers legacy progress messages before later process boundaries into commentary", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({
				id: "user-1",
				itemId: "user-item",
				turnId: "turn-1",
				role: "user",
				content: "完成这项工作",
			}),
			message({
				id: "progress-1",
				itemId: "progress-item-1",
				turnId: "turn-1",
				phase: "final_answer",
				content: "我先读取项目结构。",
			}),
			message({
				id: "tool-1",
				itemId: "tool-item-1",
				turnId: "turn-1",
				kind: "tool",
				content: "读取文件",
			}),
			message({
				id: "progress-2",
				itemId: "progress-item-2",
				turnId: "turn-1",
				content: "结构已确认，继续更新目标文件。",
			}),
			message({
				id: "tool-2",
				itemId: "tool-item-2",
				turnId: "turn-1",
				kind: "patch",
				content: "写入文件",
			}),
			message({
				id: "final-1",
				itemId: "final-item-1",
				turnId: "turn-1",
				phase: "final_answer",
				content: "工作已经完成。",
			}),
		]);

		expect(
			items.map(({ itemId, lane, message: adaptedMessage }) => ({
				itemId,
				lane,
				phase: adaptedMessage.phase,
			})),
		).toEqual([
			{ itemId: "user-item", lane: "user", phase: undefined },
			{ itemId: "progress-item-1", lane: "process", phase: "commentary" },
			{ itemId: "tool-item-1", lane: "process", phase: "commentary" },
			{ itemId: "progress-item-2", lane: "process", phase: "commentary" },
			{ itemId: "tool-item-2", lane: "process", phase: "commentary" },
			{ itemId: "final-item-1", lane: "final", phase: "final_answer" },
		]);
		expect(items.filter((item) => item.lane === "final").map((item) => item.itemId)).toEqual([
			"final-item-1",
		]);
	});

	it("strips an exact aggregate process prefix from the copied final item", () => {
		const firstProgress = "我先读取项目结构。\n";
		const secondProgress = "结构已确认，继续更新目标文件。\n";
		const aggregateFinal = `${firstProgress}${secondProgress}工作已经完成。`;
		const input = [
			message({ id: "user-1", turnId: "turn-1", role: "user" }),
			message({ id: "progress-1", turnId: "turn-1", content: firstProgress }),
			message({ id: "tool-1", turnId: "turn-1", kind: "tool" }),
			message({ id: "progress-2", turnId: "turn-1", content: secondProgress }),
			message({ id: "tool-2", turnId: "turn-1", kind: "tool" }),
			message({
				id: "final-1",
				turnId: "turn-1",
				phase: "final_answer",
				content: aggregateFinal,
			}),
		];

		const items = adaptAgentMessagesToTurnItems(input);

		expect(items.filter((item) => item.lane === "process").map((item) => item.message.id)).toEqual([
			"progress-1",
			"tool-1",
			"progress-2",
			"tool-2",
		]);
		expect(items.find((item) => item.lane === "final")?.message.content).toBe("工作已经完成。");
		expect(input.at(-1)?.content).toBe(aggregateFinal);
	});

	it("keeps the final content unchanged when the process prefix is not an exact match", () => {
		const finalContent = "摘要：正在检查。真正的最终答复。";
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "user-1", turnId: "turn-1", role: "user" }),
			message({ id: "progress-1", turnId: "turn-1", content: "正在检查。" }),
			message({ id: "tool-1", turnId: "turn-1", kind: "tool" }),
			message({ id: "final-1", turnId: "turn-1", content: finalContent }),
		]);

		expect(items.find((item) => item.lane === "final")?.message.content).toBe(finalContent);
	});

	it("does not treat form or A2UI interaction items as process boundaries", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "user-1", turnId: "turn-1", role: "user" }),
			message({
				id: "answer-before-interactions",
				turnId: "turn-1",
				phase: "final_answer",
				content: "这是最终答复。",
			}),
			message({
				id: "form-1",
				turnId: "turn-1",
				metadata: { form: { selectionId: "form-1", title: "确认", fields: [] } },
			}),
			message({
				id: "a2ui-1",
				turnId: "turn-1",
				metadata: { a2ui: { surfaceId: "surface-1", messages: [] } },
			}),
		]);

		expect(items.map((item) => [item.message.id, item.lane, item.message.phase])).toEqual([
			["user-1", "user", undefined],
			["answer-before-interactions", "final", "final_answer"],
			["form-1", "interaction", undefined],
			["a2ui-1", "interaction", undefined],
		]);
	});

	it("assigns deterministic legacy turn ids from user messages", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "user-1", role: "user", content: "第一问" }),
			message({ id: "thought-1", kind: "thought" }),
			message({ id: "answer-1", content: "第一答" }),
			message({ id: "user-2", role: "user", content: "第二问" }),
			message({ id: "answer-2", content: "第二答" }),
		]);

		expect(items.map((item) => item.turnId)).toEqual([
			"legacy-turn:user-1",
			"legacy-turn:user-1",
			"legacy-turn:user-1",
			"legacy-turn:user-2",
			"legacy-turn:user-2",
		]);
		expect(items.map((item) => item.lane)).toEqual(["user", "process", "final", "user", "final"]);
	});

	it("keeps visible runtime logs and hides transient runtime traces", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "user-1", role: "user" }),
			message({ id: "hidden-runtime", kind: "runtime", content: "已连接" }),
			message({
				id: "visible-runtime",
				kind: "runtime",
				content: "stderr output",
				metadata: { runtimeLog: true },
			}),
		]);

		expect(items.map((item) => item.message.id)).toEqual(["user-1", "visible-runtime"]);
		expect(items[1]).toMatchObject({ lane: "process", itemId: "visible-runtime" });
	});

	it("splits legacy think tags into deterministic process and final items", () => {
		const input = [
			message({ id: "user-1", role: "user" }),
			message({
				id: "assistant-1",
				itemId: "assistant-item",
				content: "开场说明<think>读取项目结构</think>继续检查<think>复核结果</think>最终结论",
			}),
		];

		const first = adaptAgentMessagesToTurnItems(input);
		const second = adaptAgentMessagesToTurnItems(input);
		const split = first.slice(1);

		expect(split.map((item) => [item.itemId, item.lane, item.message.content])).toEqual([
			["assistant-item:text:0", "process", "开场说明"],
			["assistant-item:thought:0", "process", "读取项目结构"],
			["assistant-item:text:1", "process", "继续检查"],
			["assistant-item:thought:1", "process", "复核结果"],
			["assistant-item:text:2", "final", "最终结论"],
		]);
		expect(second).toEqual(first);
	});

	it("treats unclosed think content as process output", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "assistant-1", content: "<think>还在检查" }),
		]);

		expect(items).toEqual([
			expect.objectContaining({
				turnId: "legacy-turn:orphan:assistant-1",
				itemId: "assistant-1:thought:0",
				lane: "process",
				message: expect.objectContaining({ content: "还在检查", kind: "thought" }),
			}),
		]);
	});

	it("keeps text around think tags in the commentary lane when phase is commentary", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({
				id: "commentary-1",
				phase: "commentary",
				content: "准备读取<think>选择文件</think>继续处理",
			}),
		]);

		expect(items.map((item) => item.lane)).toEqual(["process", "process", "process"]);
	});

	it("groups leading assistant output into one stable orphan turn", () => {
		const items = adaptAgentMessagesToTurnItems([
			message({ id: "assistant-1" }),
			message({ id: "tool-1", kind: "tool" }),
			message({ id: "user-1", role: "user" }),
		]);

		expect(items.map((item) => item.turnId)).toEqual([
			"legacy-turn:orphan:assistant-1",
			"legacy-turn:orphan:assistant-1",
			"legacy-turn:user-1",
		]);
	});
});
