import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { writeAgentChatCache } from "@/domains/agent/stores/chat-cache";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { AgentStateSync } from "./AgentStateSync";

const swrMock = vi.hoisted(() => ({
	data: undefined as AgentStateSyncData | undefined,
	key: undefined as string | null | undefined,
	mutate: vi.fn(),
}));

const controllerMocks = vi.hoisted(() => ({
	closeAllResumedAgentEventStreams: vi.fn(),
	resumeAgentSessionEventStream: vi.fn(),
}));

const agentApiMocks = vi.hoisted(() => ({
	getAgentChatState: vi.fn(),
	getAgentSessionStatus: vi.fn(),
}));

vi.mock("swr", () => ({
	default: (key: string | null) => {
		swrMock.key = key;
		return { data: swrMock.data };
	},
	mutate: swrMock.mutate,
}));

vi.mock("@/domains/agent/lib/controller", () => ({
	closeAllResumedAgentEventStreams: controllerMocks.closeAllResumedAgentEventStreams,
	resumeAgentSessionEventStream: controllerMocks.resumeAgentSessionEventStream,
}));

vi.mock("@/domains/agent/api/agent", () => ({
	agentChatKey: (projectId?: string | null, sessionId?: string | null) =>
		`chat:${projectId ?? ""}:${sessionId ?? ""}`,
	agentSessionsKey: (projectId?: string | null) => `sessions:${projectId ?? ""}`,
	getAgentChatState: agentApiMocks.getAgentChatState,
	getAgentSessionStatus: agentApiMocks.getAgentSessionStatus,
}));

describe("AgentStateSync", () => {
	beforeEach(() => {
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-default",
			running: false,
			lastStatus: "completed",
		});
	});

	afterEach(() => {
		cleanup();
		swrMock.data = undefined;
		swrMock.key = undefined;
		swrMock.mutate.mockReset();
		agentApiMocks.getAgentChatState.mockReset();
		agentApiMocks.getAgentSessionStatus.mockReset();
		controllerMocks.closeAllResumedAgentEventStreams.mockReset();
		controllerMocks.resumeAgentSessionEventStream.mockReset();
		useAgentStore.getState().resetSession();
		useProjectStore.setState({ activeProjectId: null });
		useAgentPersistenceStore.setState({
			documentRuntimeMode: "remote",
			sessionIdsByProject: {},
		});
		localStorage.clear();
	});

	it("hydrates matching chat data and resumes the running stream", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-1",
			running: true,
			lastStatus: "running",
		});
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "恢复的会话",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: true,
			lastEventId: "12",
		};

		render(<AgentStateSync projectId="project-1" />);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "恢复的会话" }),
		]);
		expect(useAgentStore.getState().sessionId).toBe("session-1");
		expect(controllerMocks.resumeAgentSessionEventStream).toHaveBeenCalledWith(
			"session-1",
			"project-1",
			"12",
		);
	});

	it("loads the session from the URL before persisted session state", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-persisted");

		render(<AgentStateSync projectId="project-1" routeSessionId="session-url" />);

		expect(swrMock.key).toBe("chat:project-1:session-url");
	});

	it("waits for the workspace to be ready before loading a route session", () => {
		const { rerender } = render(
			<AgentStateSync projectId="project-1" routeSessionId="session-url" workspaceReady={false} />,
		);

		expect(swrMock.key).toBeNull();

		rerender(<AgentStateSync projectId="project-1" routeSessionId="session-url" workspaceReady />);

		expect(swrMock.key).toBe("chat:project-1:session-url");
	});

	it("hydrates the URL session even when the persisted project store is stale", () => {
		useProjectStore.setState({ activeProjectId: "project-2" });
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-url",
			projectId: "project-1",
			sessionId: "session-url",
			messages: [
				{
					id: "assistant-url",
					role: "assistant",
					content: "从 URL 恢复的历史消息",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "9",
		};

		render(<AgentStateSync projectId="project-1" routeSessionId="session-url" />);

		expect(useAgentStore.getState().sessionId).toBe("session-url");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-url", content: "从 URL 恢复的历史消息" }),
		]);
	});

	it("hydrates a later requested session after an initial fallback chat response", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: null,
			projectId: "project-1",
			sessionId: "session-empty",
			messages: [],
			activity: [],
			running: false,
			lastEventId: "1",
		};

		const { rerender } = render(<AgentStateSync projectId="project-1" />);

		expect(useAgentStore.getState().sessionId).toBe("session-empty");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);

		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "恢复的历史消息",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "12",
		};

		rerender(<AgentStateSync projectId="project-1" />);

		expect(useAgentStore.getState().sessionId).toBe("session-1");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "恢复的历史消息" }),
		]);
	});

	it("hydrates restored conversation payloads even when the flat transcript is empty", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
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
		};

		render(<AgentStateSync projectId="project-1" />);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "从 conversation 恢复" }),
		]);
	});

	it("restores the cached transcript instantly when the backend has not responded", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		writeAgentChatCache({
			projectId: "project-1",
			sessionId: "session-cached",
			rootRunId: "run-1",
			lastEventId: "7",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "completed",
					messages: [
						{
							id: "assistant-cached",
							role: "assistant",
							content: "缓存里的历史消息",
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
			activity: [],
			updatedAt: "2026-06-09T00:00:00.000Z",
		});

		// swrMock.data stays undefined → the backend chat fetch has not resolved yet.
		render(<AgentStateSync projectId="project-1" />);

		expect(useAgentStore.getState().sessionId).toBe("session-cached");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-cached", content: "缓存里的历史消息" }),
		]);
		expect(useAgentStore.getState().isRunning).toBe(false);
	});

	it("ignores a cached transcript that belongs to a different project", () => {
		writeAgentChatCache({
			projectId: "project-other",
			sessionId: "session-other",
			rootRunId: "run-1",
			lastEventId: "1",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "completed",
					messages: [
						{
							id: "assistant-other",
							role: "assistant",
							content: "别的项目的消息",
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
			activity: [],
			updatedAt: "2026-06-09T00:00:00.000Z",
		});

		render(<AgentStateSync projectId="project-1" />);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);
		expect(useAgentStore.getState().sessionId).toBeNull();
	});

	it("does not hydrate stale data for a different requested session", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({ sessionId: "session-current" });
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-current",
			projectId: "project-1",
			sessionId: "session-old",
			messages: [
				{
					id: "stale",
					role: "assistant",
					content: "旧会话",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "4",
		};

		render(<AgentStateSync projectId="project-1" />);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);
		expect(useAgentStore.getState().sessionId).toBeNull();
		expect(controllerMocks.resumeAgentSessionEventStream).not.toHaveBeenCalled();
	});

	it("releases a restored running chat when the backend session is already completed", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-1",
			running: false,
			lastStatus: "completed",
			lastMessage: "Agent 运行已完成。",
		});
		agentApiMocks.getAgentChatState.mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "第二个问题",
					kind: "message",
					status: "complete",
				},
				{
					id: "assistant-1",
					role: "assistant",
					content: "第二个回答",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "13",
		});
		swrMock.data = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "第二个问题",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: true,
			lastEventId: "12",
		};

		render(<AgentStateSync projectId="project-1" />);

		await vi.waitFor(() => {
			expect(useAgentStore.getState().isRunning).toBe(false);
		});
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "user-1", content: "第二个问题" }),
			expect.objectContaining({ id: "assistant-1", content: "第二个回答" }),
		]);
		expect(agentApiMocks.getAgentSessionStatus).toHaveBeenCalledWith("session-1", "project-1");
		expect(agentApiMocks.getAgentChatState).toHaveBeenCalledWith("project-1", "session-1");
	});
});

type AgentStateSyncData = {
	__requestProjectId: string | null;
	__requestSessionId: string | null;
	projectId?: string;
	sessionId?: string | null;
	messages: Array<{
		id: string;
		role: "assistant" | "user";
		content: string;
		kind: "message";
		status: "complete";
	}>;
	activity: [];
	running: boolean;
	lastEventId?: string | null;
	rootRunId?: string | null;
	conversations?: Record<
		string,
		{
			runId: string;
			name?: string;
			status: "completed" | "running";
			messages: Array<{
				id: string;
				role: "assistant" | "user";
				content: string;
				kind: "message";
				status: "complete";
			}>;
			streamingMessageId: string | null;
			children: string[];
			createdAt: string;
			updatedAt: string;
		}
	>;
};
