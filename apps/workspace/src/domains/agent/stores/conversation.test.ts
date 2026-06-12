import { describe, expect, it } from "vitest";
import { createConversation, normalizeAgentConversations } from "./conversation";
import { upsertRuntimeLogInConversation } from "./runtime-log";
import { upsertToolCallInConversation } from "./tool-metadata";
import type { AgentConversationState } from "./types";

const baseConversation = (patch: Partial<AgentConversationState> = {}): AgentConversationState => ({
	...createConversation("run-1", { status: "running" }),
	...patch,
});

describe("agent conversation helpers", () => {
	it("normalizes persisted conversations and filters transient runtime traces", () => {
		const normalized = normalizeAgentConversations({
			"run-1": baseConversation({
				name: "  ",
				messages: [
					{
						id: "runtime-1",
						role: "assistant",
						content: "已连接",
						kind: "runtime",
						status: "complete",
					},
					{
						id: "stream-1",
						role: "assistant",
						content: "生成中",
						kind: "message",
						status: "streaming",
					},
				],
				status: "not-a-real-status" as AgentConversationState["status"],
			}),
		});

		expect(normalized["run-1"]).toMatchObject({
			runId: "run-1",
			name: "主智能体",
			status: "completed",
		});
		expect(normalized["run-1"]?.messages).toEqual([
			expect.objectContaining({
				id: "stream-1",
				status: "complete",
			}),
		]);
	});

	it("normalizes visible runtime logs but still filters ordinary runtime traces", () => {
		const normalized = normalizeAgentConversations({
			"run-1": baseConversation({
				messages: [
					{
						id: "runtime-hidden",
						role: "assistant",
						content: "已连接",
						kind: "runtime",
						status: "complete",
					},
					{
						id: "runtime-visible",
						role: "assistant",
						content: "failed to load skill",
						kind: "runtime",
						title: "运行日志",
						status: "complete",
						metadata: { runtimeLog: true },
					},
				],
			}),
		});

		expect(normalized["run-1"]?.messages).toEqual([
			expect.objectContaining({
				id: "runtime-visible",
				kind: "runtime",
				metadata: expect.objectContaining({ runtimeLog: true }),
			}),
		]);
	});

	it("normalizes legacy tool runtime logs before timeline hydration", () => {
		const normalized = normalizeAgentConversations({
			"run-1": baseConversation({
				messages: [
					{
						id: "tool-runtime-log",
						role: "assistant",
						content:
							"ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---",
						kind: "tool",
						title: "工具调用",
						status: "complete",
						metadata: {
							acpKind: "other",
							toolCallId: "runtime-log-call",
						},
					},
					{
						id: "real-tool",
						role: "assistant",
						content: "ERROR codex_core::session appeared inside returned document text",
						kind: "tool",
						title: "Tool: mediago_drama/list_documents",
						status: "complete",
						metadata: {
							acpKind: "mcp",
							toolCallId: "real-tool-call",
							locations: [{ path: "draft.md" }],
						},
					},
				],
			}),
		});

		expect(normalized["run-1"]?.messages).toEqual([
			expect.objectContaining({
				id: "tool-runtime-log",
				kind: "runtime",
				title: "运行日志",
				metadata: expect.objectContaining({
					runtimeLog: true,
					toolName: "运行日志",
				}),
			}),
			expect.objectContaining({
				id: "real-tool",
				kind: "tool",
				title: "Tool: mediago_drama/list_documents",
			}),
		]);
	});

	it("upserts ACP tool calls and records output measurements", () => {
		const conversation = baseConversation({
			streamingMessageId: "assistant-stream",
			messages: [
				{
					id: "assistant-stream",
					role: "assistant",
					content: "处理中",
					kind: "message",
					status: "streaming",
				},
			],
		});

		const next = upsertToolCallInConversation(conversation, "tool-1", {
			title: "读取文件",
			status: "completed",
			outputBlocks: [{ type: "text", text: "line one\nline two" }],
		});

		expect(next.streamingMessageId).toBeNull();
		expect(next.messages[0]).toMatchObject({
			id: "assistant-stream",
			status: "complete",
		});
		expect(next.messages[1]).toMatchObject({
			kind: "tool",
			title: "读取文件",
			status: "complete",
			metadata: expect.objectContaining({
				toolCallId: "tool-1",
				status: "completed",
				lines: 2,
			}),
		});
	});

	it("upserts visible runtime logs and records output measurements", () => {
		const conversation = baseConversation({
			streamingMessageId: "assistant-stream",
			messages: [
				{
					id: "assistant-stream",
					role: "assistant",
					content: "处理中",
					kind: "message",
					status: "streaming",
				},
			],
		});

		const next = upsertRuntimeLogInConversation(conversation, {
			toolCallId: "runtime-1",
			status: "failed",
			outputBlocks: [{ type: "text", text: "line one\nline two" }],
		});

		expect(next.streamingMessageId).toBeNull();
		expect(next.messages[0]).toMatchObject({
			id: "assistant-stream",
			status: "complete",
		});
		expect(next.messages[1]).toMatchObject({
			kind: "runtime",
			title: "运行日志",
			status: "error",
			metadata: expect.objectContaining({
				runtimeLog: true,
				toolCallId: "runtime-1",
				status: "failed",
				lines: 2,
			}),
		});
	});
});
