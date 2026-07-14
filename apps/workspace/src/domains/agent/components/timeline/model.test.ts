import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { buildAgentTurnViewModels, buildTimelineEntries, groupAssistantMessages } from "./model";

const message = (patch: Partial<AgentMessage> = {}): AgentMessage => ({
	id: patch.id ?? "message-1",
	role: patch.role ?? "assistant",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt,
	itemId: patch.itemId,
	turnId: patch.turnId,
	phase: patch.phase,
	metadata: patch.metadata,
	title: patch.title,
});

describe("agent turn view model", () => {
	it("separates process, final answer, and interaction lanes per turn", () => {
		const turns = buildAgentTurnViewModels([
			message({ id: "user-1", role: "user", turnId: "turn-1", content: "开始" }),
			message({ id: "thought-1", turnId: "turn-1", kind: "thought" }),
			message({ id: "commentary-1", turnId: "turn-1", phase: "commentary" }),
			message({ id: "final-1", turnId: "turn-1", phase: "final_answer" }),
			message({
				id: "form-1",
				turnId: "turn-1",
				metadata: { form: { selectionId: "selection-1", title: "确认", fields: [] } },
			}),
		]);

		expect(turns).toHaveLength(1);
		expect(turns[0]).toMatchObject({
			id: "turn-1",
			userMessage: { id: "user-1" },
			lifecycle: "completed",
			outcome: "succeeded",
		});
		expect(turns[0]?.processItems.map((item) => item.id)).toEqual(["thought-1", "commentary-1"]);
		expect(turns[0]?.finalAnswerItems.map((item) => item.id)).toEqual(["final-1"]);
		expect(turns[0]?.interactionItems.map((item) => item.id)).toEqual(["form-1"]);
	});

	it("keeps multiple legacy turns independent and preserves order", () => {
		const turns = buildAgentTurnViewModels([
			message({ id: "user-1", role: "user", content: "第一问" }),
			message({ id: "answer-1", content: "第一答" }),
			message({ id: "user-2", role: "user", content: "第二问" }),
			message({ id: "tool-2", kind: "tool" }),
			message({ id: "answer-2", content: "第二答" }),
		]);

		expect(turns.map((turn) => turn.id)).toEqual(["legacy-turn:user-1", "legacy-turn:user-2"]);
		expect(turns[0]?.finalAnswerItems[0]?.content).toBe("第一答");
		expect(turns[1]?.processItems[0]?.id).toBe("tool-2");
		expect(turns[1]?.finalAnswerItems[0]?.content).toBe("第二答");
	});

	it("infers an active lifecycle from streaming items", () => {
		const turns = buildAgentTurnViewModels([
			message({ id: "user-1", role: "user" }),
			message({ id: "answer-1", status: "streaming" }),
		]);

		expect(turns[0]).toMatchObject({ lifecycle: "in_progress", outcome: null });
	});

	it("allows the active turn lifecycle and outcome to be supplied by the run projection", () => {
		const turns = buildAgentTurnViewModels([message({ id: "user-1", role: "user" })], {
			activeTurn: {
				lifecycle: "waiting",
				outcome: null,
				startedAt: "2026-07-14T08:00:00.000Z",
			},
			now: "2026-07-14T08:00:05.000Z",
		});

		expect(turns[0]).toMatchObject({
			lifecycle: "waiting",
			outcome: null,
			durationMs: 5000,
		});
	});

	it("falls back to the latest turn when a legacy transcript cannot match the active run id", () => {
		const turns = buildAgentTurnViewModels(
			[message({ id: "user-1", role: "user" }), message({ id: "answer-1", phase: "final_answer" })],
			{
				activeTurnId: "run-not-yet-bound",
				activeTurn: { lifecycle: "in_progress", outcome: null },
			},
		);

		expect(turns[0]).toMatchObject({ lifecycle: "in_progress", outcome: null });
	});

	it("ignores unbound conversation timing and recovers duration from the turn messages", () => {
		const turns = buildAgentTurnViewModels(
			[
				message({
					id: "user-1",
					role: "user",
					turnId: "run-real",
					createdAt: "2026-07-14T08:00:00.000Z",
				}),
				message({
					id: "final-1",
					turnId: "run-real",
					phase: "final_answer",
					createdAt: "2026-07-14T08:02:01.000Z",
				}),
			],
			{
				activeTurnId: "pending-root-run",
				activeTurn: {
					lifecycle: "completed",
					outcome: "succeeded",
					startedAt: "2026-07-14T09:00:00.000Z",
					completedAt: "2026-07-14T09:00:00.000Z",
				},
			},
		);

		expect(turns[0]).toMatchObject({
			startedAt: "2026-07-14T08:00:00.000Z",
			completedAt: "2026-07-14T08:02:01.000Z",
			durationMs: 121_000,
		});
	});

	it("uses final output as recovery from an earlier failed process item", () => {
		const recovered = buildAgentTurnViewModels([
			message({ id: "user-1", role: "user" }),
			message({ id: "tool-1", kind: "tool", status: "error" }),
			message({ id: "final-1", phase: "final_answer" }),
		]);
		const failed = buildAgentTurnViewModels([
			message({ id: "user-2", role: "user" }),
			message({
				id: "runtime-2",
				kind: "runtime",
				status: "error",
				metadata: { runtimeLog: true },
			}),
		]);

		expect(recovered[0]).toMatchObject({
			outcome: "succeeded",
			processSummary: { hasFailure: true },
		});
		expect(failed[0]).toMatchObject({ outcome: "failed" });
	});

	it("computes wall-clock duration and a compact process summary", () => {
		const turns = buildAgentTurnViewModels([
			message({
				id: "user-1",
				role: "user",
				createdAt: "2026-07-14T08:00:00.000Z",
			}),
			message({
				id: "thought-1",
				kind: "thought",
				createdAt: "2026-07-14T08:00:01.000Z",
			}),
			message({
				id: "tool-1",
				kind: "tool",
				createdAt: "2026-07-14T08:00:02.000Z",
				metadata: { durationMs: 3000, startedAt: "2026-07-14T08:00:02.000Z" },
			}),
			message({
				id: "final-1",
				phase: "final_answer",
				createdAt: "2026-07-14T08:00:06.000Z",
			}),
		]);

		expect(turns[0]).toMatchObject({
			startedAt: "2026-07-14T08:00:00.000Z",
			completedAt: "2026-07-14T08:00:06.000Z",
			durationMs: 6000,
			processSummary: {
				label: "已处理",
				itemCount: 2,
				reasoningCount: 1,
				toolCount: 1,
				hasFailure: false,
				durationMs: 6000,
			},
		});
	});

	it("keeps final classification independent of content length and markdown", () => {
		const turns = buildAgentTurnViewModels([
			message({ id: "user-1", role: "user" }),
			message({
				id: "long-commentary",
				phase: "commentary",
				content: `## 处理中\n${"很长的过程说明".repeat(30)}`,
			}),
			message({ id: "short-final", phase: "final_answer", content: "完成。" }),
		]);

		expect(turns[0]?.processItems.map((item) => item.id)).toEqual(["long-commentary"]);
		expect(turns[0]?.finalAnswerItems.map((item) => item.id)).toEqual(["short-final"]);
	});
});

describe("legacy timeline compatibility", () => {
	it("hides ordinary runtime traces but keeps visible runtime logs", () => {
		const entries = buildTimelineEntries([
			message({ id: "hidden", kind: "runtime", content: "已连接" }),
			message({
				id: "visible",
				kind: "runtime",
				content: "failed to load skill",
				metadata: { runtimeLog: true },
			}),
		]);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			type: "assistant",
			messages: [expect.objectContaining({ id: "visible" })],
		});
	});

	it("keeps visible runtime logs outside the legacy tool group", () => {
		const items = groupAssistantMessages([
			message({ id: "runtime-log", kind: "runtime", metadata: { runtimeLog: true } }),
			message({ id: "tool-1", kind: "tool" }),
		]);

		expect(items.map((item) => item.type)).toEqual(["message", "tools"]);
	});
});
