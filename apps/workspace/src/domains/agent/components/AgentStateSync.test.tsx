import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { AgentStateSync } from "./AgentStateSync";

const swrMock = vi.hoisted(() => ({
	chatData: undefined as AgentStateSyncData | undefined,
	chatConfig: undefined as AgentRecoverySWRConfig | undefined,
	chatKey: undefined as string | null | undefined,
	chatSWRKey: undefined as string | null | undefined,
	chatSWRKeys: [] as string[],
	mutate: vi.fn(),
	sessionsConfig: undefined as AgentRecoverySWRConfig | undefined,
	sessionsData: [] as AgentSessionSummary[] | undefined,
	sessionsError: null as Error | null,
	sessionsIsLoading: false,
	sessionsKey: undefined as string | null | undefined,
	sessionsSWRKey: undefined as string | null | undefined,
	sessionsSWRKeys: [] as string[],
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
	default: (key: string | null, _fetcher?: unknown, config?: AgentRecoverySWRConfig) => {
		if (key === null) return { data: undefined, error: null, isLoading: false };
		const resourceKey = key.split("\u0000")[0];
		if (resourceKey?.startsWith("sessions:")) {
			swrMock.sessionsKey = resourceKey;
			swrMock.sessionsSWRKey = key;
			swrMock.sessionsSWRKeys.push(key);
			swrMock.sessionsConfig = config;
			return {
				data: swrMock.sessionsData,
				error: swrMock.sessionsError,
				isLoading: swrMock.sessionsIsLoading,
			};
		}
		swrMock.chatKey = resourceKey;
		swrMock.chatSWRKey = key;
		swrMock.chatSWRKeys.push(key);
		swrMock.chatConfig = config;
		return { data: swrMock.chatData };
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
	listAgentSessions: vi.fn(),
}));

const LocationProbe = () => {
	const location = useLocation();
	return <div data-testid="location" data-path={`${location.pathname}${location.search}`} />;
};

const SameProjectReentryHarness = () => {
	const location = useLocation();
	const navigate = useNavigate();
	const params = new URLSearchParams(location.search);
	const projectId = params.get("projectId");
	const routeSessionId = params.get("agentSessionId");
	return (
		<>
			<button type="button" onClick={() => navigate("/")}>
				back
			</button>
			<button
				type="button"
				onClick={() => navigate("/projects?projectId=project-1&agentSessionId=session-1")}
			>
				open
			</button>
			<AgentStateSync projectId={projectId} routeSessionId={routeSessionId} />
		</>
	);
};

type AgentStateSyncProps = ComponentProps<typeof AgentStateSync>;

const renderAgentStateSync = (
	props: AgentStateSyncProps,
	initialEntry = "/projects?projectId=project-1",
) => {
	const renderTree = (nextProps: AgentStateSyncProps) => (
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route
					path="/projects"
					element={
						<>
							<AgentStateSync {...nextProps} />
							<LocationProbe />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>
	);
	const result = render(renderTree(props));
	return {
		...result,
		rerenderAgentStateSync: (nextProps: AgentStateSyncProps) =>
			result.rerender(renderTree(nextProps)),
	};
};

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
		swrMock.chatData = undefined;
		swrMock.chatConfig = undefined;
		swrMock.chatKey = undefined;
		swrMock.chatSWRKey = undefined;
		swrMock.chatSWRKeys = [];
		swrMock.mutate.mockReset();
		swrMock.sessionsConfig = undefined;
		swrMock.sessionsData = [];
		swrMock.sessionsError = null;
		swrMock.sessionsIsLoading = false;
		swrMock.sessionsKey = undefined;
		swrMock.sessionsSWRKey = undefined;
		swrMock.sessionsSWRKeys = [];
		agentApiMocks.getAgentChatState.mockReset();
		agentApiMocks.getAgentSessionStatus.mockReset();
		controllerMocks.closeAllResumedAgentEventStreams.mockReset();
		controllerMocks.resumeAgentSessionEventStream.mockReset();
		vi.useRealTimers();
		useAgentStore.getState().resetSession();
		useAgentStore.setState({ isChatHydrating: false });
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
		swrMock.sessionsData = [agentSessionSummary("session-1")];
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-1",
			running: true,
			lastStatus: "running",
		});
		swrMock.chatData = {
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

		renderAgentStateSync({ projectId: "project-1" });

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

	it("flags chat hydration while the transcript fetch is pending and clears it once data arrives", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.chatData = undefined;

		const { rerenderAgentStateSync } = renderAgentStateSync({
			projectId: "project-1",
			routeSessionId: "session-1",
		});
		expect(useAgentStore.getState().isChatHydrating).toBe(true);

		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "服务端历史",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "5",
		};
		rerenderAgentStateSync({ projectId: "project-1", routeSessionId: "session-1" });

		expect(useAgentStore.getState().isChatHydrating).toBe(false);
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "服务端历史" }),
		]);
	});

	it("does not replace an optimistic local turn with an empty running snapshot", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.sessionsData = [agentSessionSummary("session-1")];

		const { rerenderAgentStateSync } = renderAgentStateSync({
			projectId: "project-1",
			routeSessionId: "session-1",
		});

		act(() => {
			useAgentStore.getState().startRun("可以帮我把这个小说第一集改成角色、场景、道具、分镜文档");
		});
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [],
			activity: [],
			running: true,
			lastEventId: "16",
		};

		rerenderAgentStateSync({
			projectId: "project-1",
			routeSessionId: "session-1",
		});

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({
				role: "user",
				content: "可以帮我把这个小说第一集改成角色、场景、道具、分镜文档",
			}),
		]);
		expect(useAgentStore.getState().sessionId).toBe("session-1");
		expect(useAgentStore.getState().isRunning).toBe(true);
		expect(controllerMocks.resumeAgentSessionEventStream).toHaveBeenCalledWith(
			"session-1",
			"project-1",
			"16",
		);
	});

	it("loads the session from the URL before persisted session state", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-persisted");

		renderAgentStateSync({ projectId: "project-1", routeSessionId: "session-url" });

		expect(swrMock.chatKey).toBe("chat:project-1:session-url");
	});

	it("loads the latest listed session before persisted state and syncs it into the URL", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-persisted");
		swrMock.sessionsData = [
			agentSessionSummary("session-latest"),
			agentSessionSummary("session-persisted"),
		];
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-latest",
			projectId: "project-1",
			sessionId: "session-latest",
			messages: [
				{
					id: "assistant-latest",
					role: "assistant",
					content: "最新会话",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "15",
		};

		renderAgentStateSync({ projectId: "project-1" });

		expect(swrMock.sessionsKey).toBe("sessions:project-1");
		expect(swrMock.sessionsConfig).toMatchObject({
			dedupingInterval: 0,
			revalidateOnMount: true,
		});
		await vi.waitFor(() => expect(swrMock.chatKey).toBe("chat:project-1:session-latest"));
		expect(swrMock.chatConfig).toMatchObject({
			dedupingInterval: 0,
			revalidateOnMount: true,
		});
		await vi.waitFor(() =>
			expect(document.querySelector("[data-testid='location']")?.getAttribute("data-path")).toBe(
				"/projects?projectId=project-1&agentSessionId=session-latest",
			),
		);
		expect(useAgentStore.getState().sessionId).toBe("session-latest");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-latest", content: "最新会话" }),
		]);
	});

	it("falls back to the persisted session when the latest session list is empty", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-persisted");
		swrMock.sessionsData = [];
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-persisted",
			projectId: "project-1",
			sessionId: "session-persisted",
			messages: [
				{
					id: "assistant-persisted",
					role: "assistant",
					content: "从本地记录恢复的历史消息",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "21",
		};

		renderAgentStateSync({ projectId: "project-1" });

		expect(swrMock.sessionsKey).toBe("sessions:project-1");
		expect(swrMock.chatKey).toBe("chat:project-1:session-persisted");
		await vi.waitFor(() =>
			expect(document.querySelector("[data-testid='location']")?.getAttribute("data-path")).toBe(
				"/projects?projectId=project-1&agentSessionId=session-persisted",
			),
		);
		expect(useAgentStore.getState().sessionId).toBe("session-persisted");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({
				id: "assistant-persisted",
				content: "从本地记录恢复的历史消息",
			}),
		]);
	});

	it("does not rewrite document routes while the agent surface is hidden", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.sessionsData = [agentSessionSummary("session-latest")];

		renderAgentStateSync(
			{ agentSurfaceActive: false, projectId: "project-1" },
			"/projects?projectId=project-1&documentId=doc-1",
		);

		expect(document.querySelector("[data-testid='location']")?.getAttribute("data-path")).toBe(
			"/projects?projectId=project-1&documentId=doc-1",
		);
		expect(swrMock.sessionsKey).toBeUndefined();
	});

	it("loads a route session without waiting for the document workspace", () => {
		renderAgentStateSync({
			projectId: "project-1",
			routeSessionId: "session-url",
		});

		expect(swrMock.chatKey).toBe("chat:project-1:session-url");
	});

	it("uses a fresh SWR recovery key after leaving and re-entering the same project session", async () => {
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "同项目重新进入也要恢复",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "9",
		};

		render(
			<MemoryRouter initialEntries={["/projects?projectId=project-1&agentSessionId=session-1"]}>
				<SameProjectReentryHarness />
			</MemoryRouter>,
		);

		const firstSWRKey = swrMock.chatSWRKey;
		expect(swrMock.chatKey).toBe("chat:project-1:session-1");
		expect(firstSWRKey).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "back" }));
		fireEvent.click(screen.getByRole("button", { name: "open" }));

		expect(swrMock.chatKey).toBe("chat:project-1:session-1");
		await vi.waitFor(() => expect(swrMock.chatSWRKey).not.toBe(firstSWRKey));
		expect(new Set(swrMock.chatSWRKeys).size).toBeGreaterThan(1);
	});

	it("does not reuse a session id left in the global agent store for another project", () => {
		useAgentStore.setState({ sessionId: "session-project-a" });
		swrMock.sessionsData = [];

		renderAgentStateSync({ projectId: "project-b" }, "/projects?projectId=project-b");

		expect(swrMock.sessionsKey).toBe("sessions:project-b");
		expect(swrMock.chatKey).toBe("chat:project-b:");
	});

	it("hydrates the URL session even when the persisted project store is stale", () => {
		useProjectStore.setState({ activeProjectId: "project-2" });
		swrMock.chatData = {
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

		renderAgentStateSync({ projectId: "project-1", routeSessionId: "session-url" });

		expect(useAgentStore.getState().sessionId).toBe("session-url");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-url", content: "从 URL 恢复的历史消息" }),
		]);
	});

	it("hydrates a later requested session after an initial fallback chat response", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: null,
			projectId: "project-1",
			sessionId: "session-empty",
			messages: [],
			activity: [],
			running: false,
			lastEventId: "1",
		};

		const { rerenderAgentStateSync } = renderAgentStateSync({ projectId: "project-1" });

		expect(useAgentStore.getState().sessionId).toBe("session-empty");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);

		swrMock.sessionsData = [agentSessionSummary("session-1")];
		swrMock.chatData = {
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

		rerenderAgentStateSync({ projectId: "project-1" });

		expect(useAgentStore.getState().sessionId).toBe("session-1");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "恢复的历史消息" }),
		]);
	});

	it("hydrates fresh fallback chat after an empty cached fallback response", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: null,
			projectId: "project-1",
			sessionId: null,
			messages: [],
			activity: [],
			running: false,
			lastEventId: null,
		};

		const { rerenderAgentStateSync } = renderAgentStateSync({ projectId: "project-1" });

		expect(useAgentStore.getState().sessionId).toBeNull();
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);

		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: null,
			projectId: "project-1",
			sessionId: "session-latest",
			messages: [
				{
					id: "assistant-latest",
					role: "assistant",
					content: "后端返回的最新会话",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "15",
		};

		rerenderAgentStateSync({ projectId: "project-1" });

		expect(useAgentStore.getState().sessionId).toBe("session-latest");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-latest", content: "后端返回的最新会话" }),
		]);
	});

	it("hydrates restored conversation payloads even when the flat transcript is empty", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		swrMock.sessionsData = [agentSessionSummary("session-1")];
		swrMock.chatData = {
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

		renderAgentStateSync({ projectId: "project-1" });

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-1", content: "从 conversation 恢复" }),
		]);
	});

	it("does not hydrate stale data for a different requested session", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({ sessionId: "session-current" });
		swrMock.chatData = {
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

		renderAgentStateSync({ projectId: "project-1" });

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([]);
		expect(useAgentStore.getState().sessionId).toBeNull();
		expect(controllerMocks.resumeAgentSessionEventStream).not.toHaveBeenCalled();
	});

	it("releases a restored running chat when the backend session is already completed", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		swrMock.sessionsData = [agentSessionSummary("session-1")];
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
		swrMock.chatData = {
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

		renderAgentStateSync({ projectId: "project-1" });

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

	it("rechecks a running session when returning from the project overview", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentPersistenceStore.getState().setSessionId("project-1", "session-1");
		swrMock.chatData = {
			__requestProjectId: "project-1",
			__requestSessionId: "session-1",
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "继续处理",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: true,
			lastEventId: "12",
		};
		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-1",
			running: true,
			lastStatus: "running",
		});
		agentApiMocks.getAgentChatState.mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-1",
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "继续处理",
					kind: "message",
					status: "complete",
				},
				{
					id: "assistant-1",
					role: "assistant",
					content: "处理完成",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "13",
		});

		const { rerenderAgentStateSync } = renderAgentStateSync({
			agentSurfaceActive: false,
			projectId: "project-1",
			routeSessionId: "session-1",
		});

		await vi.waitFor(() => expect(agentApiMocks.getAgentSessionStatus).toHaveBeenCalledTimes(1));
		expect(useAgentStore.getState().isRunning).toBe(true);

		agentApiMocks.getAgentSessionStatus.mockResolvedValue({
			sessionId: "session-1",
			running: false,
			lastStatus: "completed",
			lastMessage: "Agent 运行已完成。",
		});
		rerenderAgentStateSync({
			agentSurfaceActive: true,
			projectId: "project-1",
			routeSessionId: "session-1",
		});

		await vi.waitFor(() => expect(useAgentStore.getState().isRunning).toBe(false));
		expect(agentApiMocks.getAgentSessionStatus).toHaveBeenCalledTimes(2);
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "user-1", content: "继续处理" }),
			expect.objectContaining({ id: "assistant-1", content: "处理完成" }),
		]);
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

type AgentSessionSummary = {
	sessionId: string;
	projectId?: string;
	title?: string;
	lastStatus?: string;
	lastMessage?: string;
	updatedAt?: string;
	running: boolean;
};

type AgentRecoverySWRConfig = {
	dedupingInterval?: number;
	revalidateIfStale?: boolean;
	revalidateOnFocus?: boolean;
	revalidateOnMount?: boolean;
};

const agentSessionSummary = (sessionId: string): AgentSessionSummary => ({
	sessionId,
	projectId: "project-1",
	updatedAt: "2026-06-09T00:00:00.000Z",
	running: false,
});
