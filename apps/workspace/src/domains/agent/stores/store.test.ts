import { afterEach, describe, expect, it } from "vitest";
import type { AgentReference } from "@/domains/agent/api/agent";
import { pendingRootRunId } from "./constants";
import { selectAgentMessages } from "./selectors";
import { useAgentStore } from "./store";

const assetReference: AgentReference = {
	kind: "asset",
	documentId: "asset-1",
	assetId: "asset-1",
	assetKind: "text",
	mimeType: "text/plain",
	title: "素材.txt",
	category: "reference",
	url: "/assets/asset-1.txt",
};

describe("agent store composer seed", () => {
	afterEach(() => {
		useAgentStore.getState().resetSession();
		useAgentStore.setState({ composerSeed: null, runtimeAlerts: [] });
	});

	it("stores and consumes one-shot composer seed data", () => {
		useAgentStore.getState().seedComposer({
			reference: assetReference,
			text: "请概述这份素材",
			focus: true,
		});

		expect(useAgentStore.getState().composerSeed).toEqual({
			reference: assetReference,
			text: "请概述这份素材",
			focus: true,
		});

		useAgentStore.getState().consumeComposerSeed();

		expect(useAgentStore.getState().composerSeed).toBeNull();
	});

	it("stores mention-only composer seed data", () => {
		useAgentStore.getState().seedComposer({
			reference: assetReference,
			focus: true,
		});

		expect(useAgentStore.getState().composerSeed).toEqual({
			reference: assetReference,
			focus: true,
		});
	});
});

describe("agent store runtime recovery", () => {
	afterEach(() => {
		useAgentStore.getState().resetSession();
		useAgentStore.setState({ runtimeAlerts: [] });
	});

	it("hydrates pending permission requests from chat state", () => {
		useAgentStore.getState().hydrateAgentChatState([], [], {
			sessionId: "session-1",
			running: true,
			pendingPermissions: [
				{
					requestId: "permission-1",
					options: [{ optionId: "allow", kind: "allow_once", name: "Allow once" }],
					toolCall: { title: "写入 Project Brief" },
				},
			],
		});

		expect(useAgentStore.getState().permissionRequests).toEqual([
			expect.objectContaining({
				requestId: "permission-1",
				toolCall: { title: "写入 Project Brief" },
			}),
		]);
	});

	it("does not hydrate stale permissions for completed chat state", () => {
		useAgentStore.getState().hydrateAgentChatState([], [], {
			sessionId: "session-1",
			running: false,
			pendingPermissions: [
				{
					requestId: "permission-1",
					options: [{ optionId: "allow", kind: "allow_once", name: "Allow once" }],
					toolCall: { title: "Read 素材.txt" },
				},
			],
		});

		expect(useAgentStore.getState().permissionRequests).toEqual([]);
	});

	it("syncs pending permission requests as the backend status mirror", () => {
		useAgentStore.getState().syncPermissionRequests([
			{
				requestId: " permission-1 ",
				options: [{ optionId: "allow", kind: "allow_once", name: "Allow once" }],
				toolCall: { title: "Read 素材.txt" },
			},
			{
				requestId: "permission-2",
				options: [{ optionId: "abort", kind: "reject_once", name: "No" }],
				toolCall: { title: "Edit 文档.md" },
			},
		]);

		expect(useAgentStore.getState().permissionRequests.map((request) => request.requestId)).toEqual(
			["permission-1", "permission-2"],
		);

		useAgentStore.getState().syncPermissionRequests([
			{
				requestId: "permission-2",
				options: [{ optionId: "abort", kind: "reject_once", name: "No" }],
				toolCall: { title: "Edit 文档.md" },
			},
		]);

		expect(useAgentStore.getState().permissionRequests).toEqual([
			expect.objectContaining({ requestId: "permission-2" }),
		]);
	});

	it("records runtime alerts for visible chat cards", () => {
		useAgentStore.getState().addRuntimeAlert({
			title: "文档 MCP 未挂载",
			message: "mediago_drama MCP 工具未挂载。",
			reason: "executable_unavailable",
		});

		expect(useAgentStore.getState().runtimeAlerts).toEqual([
			expect.objectContaining({
				title: "文档 MCP 未挂载",
				message: "mediago_drama MCP 工具未挂载。",
				reason: "executable_unavailable",
			}),
		]);
	});
});

describe("agent store thought streaming", () => {
	afterEach(() => {
		useAgentStore.getState().resetSession();
		useAgentStore.setState({
			activity: [],
			conversations: {},
			isRunning: false,
			rootRunId: null,
			streamingMessageId: null,
		});
	});

	it("merges consecutive thought chunks into one message", () => {
		useAgentStore.getState().addUserMessage("你好");
		useAgentStore.getState().appendThought("用户");
		useAgentStore.getState().appendThought("只是打了个");
		useAgentStore.getState().appendThought("招呼");

		const thoughts = selectAgentMessages(useAgentStore.getState()).filter(
			(message) => message.kind === "thought",
		);
		expect(thoughts).toHaveLength(1);
		expect(thoughts[0]?.content).toBe("用户只是打了个招呼");
	});

	it("starts a new thought block after another message kind", () => {
		useAgentStore.getState().addUserMessage("你好");
		useAgentStore.getState().appendThought("第一段思考");
		useAgentStore.getState().appendAssistantDelta("回复内容");
		useAgentStore.getState().appendThought("第二段思考");

		const thoughts = selectAgentMessages(useAgentStore.getState()).filter(
			(message) => message.kind === "thought",
		);
		expect(thoughts).toHaveLength(2);
		expect(thoughts[0]?.content).toBe("第一段思考");
		expect(thoughts[1]?.content).toBe("第二段思考");
	});

	it("skips whitespace-only chunks and trims a new block's leading whitespace", () => {
		useAgentStore.getState().addUserMessage("你好");
		useAgentStore.getState().appendThought("\n\n");
		useAgentStore.getState().appendThought("\n\n用户");
		useAgentStore.getState().appendThought("打招呼");

		const thoughts = selectAgentMessages(useAgentStore.getState()).filter(
			(message) => message.kind === "thought",
		);
		expect(thoughts).toHaveLength(1);
		expect(thoughts[0]?.content).toBe("用户打招呼");
	});
});

describe("agent store pending user turns", () => {
	afterEach(() => {
		useAgentStore.getState().resetSession();
		useAgentStore.setState({
			activity: [],
			conversations: {},
			isRunning: false,
			rootRunId: null,
			runtimeAlerts: [],
			streamingMessageId: null,
		});
	});

	it("records a sent user message before the run starts", () => {
		useAgentStore.getState().addUserMessage("这个故事讲了什么", {
			displayAttachments: [{ name: "素材.txt", size: 1024 }],
		});

		const state = useAgentStore.getState();
		expect(state.isRunning).toBe(false);
		expect(state.rootRunId).toBe(pendingRootRunId);
		expect(state.conversations[pendingRootRunId]).toMatchObject({
			status: "completed",
			messages: [
				expect.objectContaining({
					role: "user",
					content: "这个故事讲了什么",
					metadata: {
						displayAttachments: [{ name: "素材.txt", size: 1024 }],
					},
				}),
			],
		});
	});

	it("keeps existing chat messages visible when starting a follow-up run", () => {
		useAgentStore.setState({
			rootRunId: "run-1",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "completed",
					messages: [
						{
							id: "user-1",
							role: "user",
							content: "第一个问题",
							kind: "message",
							status: "complete",
						},
						{
							id: "assistant-1",
							role: "assistant",
							content: "第一个回答",
							kind: "message",
							status: "complete",
						},
					],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-06-09T00:00:00.000Z",
					updatedAt: "2026-06-09T00:00:00.000Z",
				},
			},
		});

		useAgentStore.getState().startRun("第二个问题");

		const state = useAgentStore.getState();
		expect(state.rootRunId).toBe(pendingRootRunId);
		expect(selectAgentMessages(state)).toEqual([
			expect.objectContaining({ role: "user", content: "第一个问题" }),
			expect.objectContaining({ role: "assistant", content: "第一个回答" }),
			expect.objectContaining({ role: "user", content: "第二个问题" }),
		]);
	});

	it("keeps existing chat messages visible when staging a user message before confirmation", () => {
		useAgentStore.setState({
			rootRunId: "run-1",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "completed",
					messages: [
						{
							id: "user-1",
							role: "user",
							content: "第一个问题",
							kind: "message",
							status: "complete",
						},
						{
							id: "assistant-1",
							role: "assistant",
							content: "第一个回答",
							kind: "message",
							status: "complete",
						},
					],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-06-09T00:00:00.000Z",
					updatedAt: "2026-06-09T00:00:00.000Z",
				},
			},
		});

		useAgentStore.getState().addUserMessage("第二个问题");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ role: "user", content: "第一个问题" }),
			expect.objectContaining({ role: "assistant", content: "第一个回答" }),
			expect.objectContaining({ role: "user", content: "第二个问题" }),
		]);
	});

	it("marks the pending user turn as running after confirmation", () => {
		useAgentStore.getState().addUserMessage("这个故事讲了什么");
		useAgentStore.getState().beginPendingRun();

		const state = useAgentStore.getState();
		expect(state.isRunning).toBe(true);
		expect(state.conversations[pendingRootRunId]?.status).toBe("running");
	});

	it("removes an A2UI message from the active conversation", () => {
		useAgentStore.getState().addUserMessage("这个故事讲了什么");
		useAgentStore.getState().addA2UIMessage({
			version: "v0.9",
			surfaceId: "surface-1",
			messages: [],
		});
		const uiMessage = selectAgentMessages(useAgentStore.getState()).find(
			(message) => message.metadata?.a2ui,
		);
		expect(uiMessage).toBeTruthy();

		useAgentStore.getState().removeMessage(uiMessage?.id ?? "");

		const state = useAgentStore.getState();
		expect(selectAgentMessages(state).some((message) => message.id === uiMessage?.id)).toBe(false);
		expect(
			state.conversations[pendingRootRunId]?.messages.some(
				(message) => message.id === uiMessage?.id,
			),
		).toBe(false);
	});
});
