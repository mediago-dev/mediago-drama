import { afterEach, describe, expect, it, vi } from "vitest";
import { mutate as mutateSWR } from "swr";
import { getAgentChatState } from "@/domains/agent/api/agent";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { refreshAgentChatTranscript } from "./chat-sync";

vi.mock("swr", () => ({
	mutate: vi.fn(),
}));

vi.mock("@/domains/agent/api/agent", () => ({
	agentChatKey: (projectId?: string | null, sessionId?: string | null) =>
		`chat:${projectId ?? ""}:${sessionId ?? ""}`,
	agentSessionsKey: (projectId?: string | null) => `sessions:${projectId ?? ""}`,
	getAgentChatState: vi.fn(),
}));

describe("refreshAgentChatTranscript", () => {
	afterEach(() => {
		vi.mocked(getAgentChatState).mockReset();
		vi.mocked(mutateSWR).mockReset();
		useProjectStore.setState({ activeProjectId: null });
		useAgentStore.setState({
			activity: [],
			conversations: {},
			isRunning: false,
			lastEventId: null,
			permissionRequests: [],
			rootRunId: null,
			sessionId: null,
			streamingMessageId: null,
		});
	});

	it("hydrates the active chat from the session transcript and refreshes SWR caches", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({ sessionId: "session-1" });
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "最新回复",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "12",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(getAgentChatState).toHaveBeenCalledWith("project-1", "session-1");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "最新回复" }),
		]);
		expect(useAgentStore.getState().lastEventId).toBe("12");
		expect(mutateSWR).toHaveBeenCalledWith(
			"chat:project-1:session-1",
			expect.objectContaining({ sessionId: "session-1" }),
			{ revalidate: false },
		);
		expect(mutateSWR).toHaveBeenCalledWith("sessions:project-1");
	});

	it("trusts an explicit project id while the project store is still hydrating", async () => {
		useProjectStore.setState({ activeProjectId: null });
		useAgentStore.setState({ sessionId: "session-1" });
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "Electron 刷新恢复",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "12",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(getAgentChatState).toHaveBeenCalledWith("project-1", "session-1");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "Electron 刷新恢复" }),
		]);
	});

	it("ignores a transcript for a different project", async () => {
		useProjectStore.setState({ activeProjectId: null });
		useAgentStore.setState({ sessionId: "session-1" });
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-2",
			sessionId: "session-1",
			messages: [
				{
					id: "stale",
					role: "assistant",
					content: "其它项目",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "12",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);
		expect(mutateSWR).not.toHaveBeenCalled();
	});

	it("hydrates restored conversations when the refreshed flat transcript is empty", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({ sessionId: "session-1" });
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [],
			activity: [],
			running: false,
			lastEventId: "12",
			rootRunId: "run-1",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "completed",
					messages: [
						{
							id: "assistant-1",
							role: "assistant",
							content: "从 conversation 恢复",
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

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "从 conversation 恢复" }),
		]);
		expect(useAgentStore.getState().rootRunId).toBe("run-1");
	});

	it("does not overwrite the store when a stale transcript response is for another session", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			sessionId: "session-2",
			rootRunId: "run-current",
			conversations: {
				"run-current": {
					runId: "run-current",
					status: "completed",
					messages: [
						{
							id: "current",
							role: "assistant",
							content: "当前会话",
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
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "stale",
					role: "assistant",
					content: "迟到回复",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "9",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "current", content: "当前会话" }),
		]);
		expect(mutateSWR).not.toHaveBeenCalled();
	});

	it("keeps local streaming output when the transcript lacks an assistant message after the latest user", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			sessionId: "session-1",
			rootRunId: "run-current",
			conversations: {
				"run-current": {
					runId: "run-current",
					status: "running",
					messages: [
						{
							id: "user-1",
							role: "user",
							content: "请问你是谁",
							kind: "message",
							status: "complete",
						},
						{
							id: "assistant-local",
							role: "assistant",
							content: "我是 MediaGo Drama 的项目 Agent。",
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
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-old",
					role: "assistant",
					content: "上一轮回答。我是 MediaGo Drama 的项目 Agent。",
					kind: "message",
					status: "complete",
				},
				{
					id: "user-1",
					role: "user",
					content: "请问你是谁",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "15",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "user-1", content: "请问你是谁" }),
			expect.objectContaining({
				id: "assistant-local",
				content: "我是 MediaGo Drama 的项目 Agent。",
			}),
		]);
		expect(mutateSWR).not.toHaveBeenCalledWith(
			"chat:project-1:session-1",
			expect.anything(),
			expect.anything(),
		);
		expect(mutateSWR).toHaveBeenCalledWith("sessions:project-1");
	});

	it("keeps a just-sent local user turn when the transcript has not caught up yet", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			sessionId: "session-1",
			rootRunId: "run-current",
			conversations: {
				"run-current": {
					runId: "run-current",
					status: "running",
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
						{
							id: "user-2",
							role: "user",
							content: "第二个问题",
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
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
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
			activity: [],
			running: true,
			lastEventId: "16",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "user-1", content: "第一个问题" }),
			expect.objectContaining({ id: "assistant-1", content: "第一个回答" }),
			expect.objectContaining({ id: "user-2", content: "第二个问题" }),
		]);
		expect(mutateSWR).not.toHaveBeenCalledWith(
			"chat:project-1:session-1",
			expect.anything(),
			expect.anything(),
		);
		expect(mutateSWR).toHaveBeenCalledWith("sessions:project-1");
	});

	it("keeps earlier local turns when a refreshed transcript only contains the current run", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			sessionId: "session-1",
			rootRunId: "run-current",
			conversations: {
				"run-current": {
					runId: "run-current",
					status: "running",
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
						{
							id: "user-2",
							role: "user",
							content: "第二个问题",
							kind: "message",
							status: "complete",
						},
						{
							id: "assistant-2",
							role: "assistant",
							content: "第二个回答",
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
		vi.mocked(getAgentChatState).mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "user-2-backend",
					role: "user",
					content: "第二个问题",
					kind: "message",
					status: "complete",
				},
				{
					id: "assistant-2-backend",
					role: "assistant",
					content: "第二个回答",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: true,
			lastEventId: "20",
		});

		await refreshAgentChatTranscript("session-1", "project-1");

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "user-1", content: "第一个问题" }),
			expect.objectContaining({ id: "assistant-1", content: "第一个回答" }),
			expect.objectContaining({ id: "user-2", content: "第二个问题" }),
			expect.objectContaining({ id: "assistant-2", content: "第二个回答" }),
		]);
		expect(mutateSWR).not.toHaveBeenCalledWith(
			"chat:project-1:session-1",
			expect.anything(),
			expect.anything(),
		);
		expect(mutateSWR).toHaveBeenCalledWith("sessions:project-1");
	});
});
