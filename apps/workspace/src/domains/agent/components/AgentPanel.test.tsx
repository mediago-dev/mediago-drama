import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/domains/projects/stores";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { AgentPanel } from "./AgentPanel";

const swrMocks = vi.hoisted(() => ({
	mutate: vi.fn(),
}));

const agentApiMocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	getAgentChatState: vi.fn(),
	listAgentSessions: vi.fn(),
}));

vi.mock("swr", () => ({
	default: () => ({
		data: [
			{
				sessionId: "session-history-1",
				title: "整理素材清单",
				lastStatus: "completed",
				lastMessage: "整理素材",
				updatedAt: "2026-06-08T08:00:00.000Z",
				running: false,
			},
		],
		error: null,
		isLoading: false,
	}),
	useSWRConfig: () => ({ mutate: swrMocks.mutate }),
}));

vi.mock("@/domains/agent/api/agent", () => ({
	agentChatKey: (projectId?: string | null, sessionId?: string | null) =>
		`chat:${projectId ?? ""}:${sessionId ?? ""}`,
	agentSessionsKey: (projectId?: string | null) => `sessions:${projectId ?? ""}`,
	createAgentSession: agentApiMocks.createAgentSession,
	getAgentChatState: agentApiMocks.getAgentChatState,
	listAgentSessions: agentApiMocks.listAgentSessions,
}));

vi.mock("@/domains/agent/components/AgentChat", () => ({
	AgentChat: () => <div>当前聊天内容</div>,
}));

const LocationProbe = () => {
	const location = useLocation();
	return <div data-testid="location" data-path={`${location.pathname}${location.search}`} />;
};

const ProjectSwitchProbe = () => {
	const navigate = useNavigate();
	return (
		<button type="button" onClick={() => navigate("/projects?projectId=project-2")}>
			切换项目
		</button>
	);
};

const renderAgentPanel = (initialEntry = "/projects?projectId=project-1") =>
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route
					path="/projects"
					element={
						<>
							<AgentPanel />
							<LocationProbe />
							<ProjectSwitchProbe />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);

describe("AgentPanel", () => {
	afterEach(() => {
		cleanup();
		agentApiMocks.createAgentSession.mockReset();
		agentApiMocks.getAgentChatState.mockReset();
		agentApiMocks.listAgentSessions.mockReset();
		swrMocks.mutate.mockReset();
		useAgentStore.getState().resetSession();
		useProjectStore.setState({ activeProjectId: null });
	});

	it("opens session history as a dropdown without replacing chat", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });

		renderAgentPanel();

		expect(screen.getByText("当前聊天内容")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /历史会话/ }));

		expect(screen.getByRole("menu")).toBeTruthy();
		expect(screen.getByText("整理素材清单")).toBeTruthy();
		expect(screen.getByText("整理素材")).toBeTruthy();
		expect(screen.getByText("当前聊天内容")).toBeTruthy();
	});

	it("writes the selected history session id into the URL", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		agentApiMocks.getAgentChatState.mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-history-1",
			messages: [
				{
					id: "assistant-history",
					role: "assistant",
					content: "历史会话内容",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "8",
		});

		renderAgentPanel("/projects?projectId=project-1&documentId=doc-1");
		fireEvent.click(screen.getByRole("button", { name: /历史会话/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: /整理素材清单/ }));

		await waitFor(() =>
			expect(screen.getByTestId("location").dataset.path).toBe(
				"/projects?projectId=project-1&agentSessionId=session-history-1",
			),
		);
		expect(useAgentStore.getState().sessionId).toBe("session-history-1");
	});

	it("uses the route project id when the persisted project store is stale", async () => {
		useProjectStore.setState({ activeProjectId: "project-2" });
		agentApiMocks.getAgentChatState.mockResolvedValue({
			projectId: "project-1",
			sessionId: "session-history-1",
			messages: [
				{
					id: "assistant-history",
					role: "assistant",
					content: "URL 项目的历史会话",
					kind: "message",
					status: "complete",
				},
			],
			activity: [],
			running: false,
			lastEventId: "8",
		});

		renderAgentPanel("/projects?projectId=project-1");
		fireEvent.click(screen.getByRole("button", { name: /历史会话/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: /整理素材清单/ }));

		await waitFor(() => {
			expect(agentApiMocks.getAgentChatState).toHaveBeenCalledWith(
				"project-1",
				"session-history-1",
			);
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").dataset.path).toBe(
				"/projects?projectId=project-1&agentSessionId=session-history-1",
			),
		);
		expect(useAgentStore.getState().sessionId).toBe("session-history-1");
		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "assistant-history", content: "URL 项目的历史会话" }),
		]);
	});

	it("ignores a stale history session response after switching projects", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.getState().hydrateAgentChatState(
			[
				{
					id: "current",
					role: "assistant",
					content: "当前项目会话",
					kind: "message",
					status: "complete",
				},
			],
			[],
			{ sessionId: "session-current", running: false },
		);
		const chatState = createDeferred<{
			projectId: string;
			sessionId: string;
			messages: Array<{
				id: string;
				role: "assistant";
				content: string;
				kind: "message";
				status: "complete";
			}>;
			activity: [];
			running: false;
			lastEventId: string;
		}>();
		agentApiMocks.getAgentChatState.mockReturnValueOnce(chatState.promise);

		renderAgentPanel();
		fireEvent.click(screen.getByRole("button", { name: /历史会话/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: /整理素材清单/ }));

		await waitFor(() => {
			expect(agentApiMocks.getAgentChatState).toHaveBeenCalledWith(
				"project-1",
				"session-history-1",
			);
		});

		act(() => {
			useProjectStore.setState({ activeProjectId: "project-2" });
		});
		fireEvent.click(screen.getByRole("button", { name: "切换项目" }));
		await act(async () => {
			chatState.resolve({
				projectId: "project-1",
				sessionId: "session-history-1",
				messages: [
					{
						id: "stale",
						role: "assistant",
						content: "迟到的旧项目会话",
						kind: "message",
						status: "complete",
					},
				],
				activity: [],
				running: false,
				lastEventId: "7",
			});
			await chatState.promise;
		});

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ id: "current", content: "当前项目会话" }),
		]);
		expect(swrMocks.mutate).not.toHaveBeenCalledWith(
			"chat:project-1:session-history-1",
			expect.anything(),
			expect.anything(),
		);
	});
});

const createDeferred = <T,>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
};
