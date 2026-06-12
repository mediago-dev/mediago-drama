import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { buildTimelineEntries, groupAssistantMessages } from "./model";

const assistantMessage = (patch: Partial<AgentMessage>): AgentMessage => ({
	id: patch.id ?? "message-1",
	role: "assistant",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	metadata: patch.metadata,
	title: patch.title,
	createdAt: patch.createdAt,
});

describe("agent timeline model", () => {
	it("hides ordinary runtime traces", () => {
		const entries = buildTimelineEntries([
			assistantMessage({
				id: "runtime-1",
				kind: "runtime",
				title: "ACP",
				content: "已连接",
			}),
		]);

		expect(entries).toEqual([]);
	});

	it("keeps visible runtime logs in the assistant timeline", () => {
		const entries = buildTimelineEntries([
			assistantMessage({
				id: "runtime-log-1",
				kind: "runtime",
				title: "运行日志",
				content: "failed to load skill",
				metadata: { runtimeLog: true },
			}),
		]);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			type: "assistant",
			messages: [
				expect.objectContaining({
					id: "runtime-log-1",
					kind: "runtime",
					metadata: { runtimeLog: true },
				}),
			],
		});
	});

	it("does not put visible runtime logs into the tool group", () => {
		const items = groupAssistantMessages([
			assistantMessage({
				id: "runtime-log-1",
				kind: "runtime",
				title: "运行日志",
				content: "failed to load skill",
				metadata: { runtimeLog: true },
			}),
			assistantMessage({
				id: "tool-1",
				kind: "tool",
				title: "Tool: mediago_drama/list_documents",
			}),
		]);

		expect(items).toEqual([
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ id: "runtime-log-1", kind: "runtime" }),
			}),
			expect.objectContaining({
				type: "tools",
				messages: [expect.objectContaining({ id: "tool-1", kind: "tool" })],
			}),
		]);
	});
});
