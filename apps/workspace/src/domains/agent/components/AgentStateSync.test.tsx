import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { AgentStateSync } from "./AgentStateSync";

const swrMock = vi.hoisted(() => ({
	data: undefined as AgentStateSyncData | undefined,
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
	default: () => ({ data: swrMock.data }),
}));

vi.mock("@/domains/agent/lib/controller", () => ({
	closeAllResumedAgentEventStreams: controllerMocks.closeAllResumedAgentEventStreams,
	resumeAgentSessionEventStream: controllerMocks.resumeAgentSessionEventStream,
}));

vi.mock("@/domains/agent/api/agent", () => ({
	agentChatKey: (projectId?: string | null, sessionId?: string | null) =>
		`chat:${projectId ?? ""}:${sessionId ?? ""}`,
	getAgentChatState: agentApiMocks.getAgentChatState,
	getAgentSessionStatus: agentApiMocks.getAgentSessionStatus,
}));

describe("AgentStateSync", () => {
	afterEach(() => {
		cleanup();
		swrMock.data = undefined;
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
	});

	it("hydrates matching chat data and resumes the running stream", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({ lastStatus: "completed" });
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
});

type AgentStateSyncData = {
	__requestProjectId: string | null;
	__requestSessionId: string | null;
	projectId?: string;
	sessionId?: string | null;
	messages: Array<{
		id: string;
		role: "assistant";
		content: string;
		kind: "message";
		status: "complete";
	}>;
	activity: [];
	running: boolean;
	lastEventId?: string | null;
};
