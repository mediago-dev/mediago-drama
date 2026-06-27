import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAgentEventSource,
	getAgentSessionStatus,
	type AgentRuntimeEvent,
} from "@/domains/agent/api/agent";
import { connectRemoteAgentRuntime } from "@/domains/agent/lib/remote-runtime";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
import { pendingRootRunId } from "@/domains/agent/stores/constants";
import { useProjectStore } from "@/domains/projects/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { MarkdownDocument } from "@/domains/documents/stores";
import {
	agentSessionStorageKey,
	closeAllResumedAgentEventStreams,
	closeResumedAgentEventStream,
	handleStreamingAgentEvent,
	resumeAgentSessionEventStream,
	runAgentPrompt,
} from "@/domains/agent/lib/controller";

vi.mock("@/domains/agent/api/agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/agent/api/agent")>();
	return {
		...actual,
		createAgentEventSource: vi.fn(),
		getAgentSessionStatus: vi.fn(),
	};
});

vi.mock("@/domains/agent/lib/remote-runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/agent/lib/remote-runtime")>();
	return {
		...actual,
		connectRemoteAgentRuntime: vi.fn(),
	};
});

const testDocument: MarkdownDocument = {
	id: "doc-1",
	title: "测试文档",
	content: "",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: new Date().toISOString(),
	isDirty: false,
	comments: [],
	workbenchDraft: null,
};

const eventContext = () => ({
	anchorText: "",
	activeDocument: testDocument,
	getLatestDelta: () => "",
	isSelectionScoped: false,
	projectId: "project-1",
	setLatestDelta: () => {},
});

const acpEvent = (acp: NonNullable<Extract<AgentRuntimeEvent, { type: "agent.acp" }>["acp"]>) =>
	({
		id: "event-1",
		sessionId: "session-1",
		type: "agent.acp",
		message: "",
		createdAt: new Date().toISOString(),
		acp,
	}) satisfies AgentRuntimeEvent;

const pendingRequest = (requestId: string) => ({
	requestId,
	options: [{ optionId: "allow", kind: "allow_once", name: "Allow once" }],
	toolCall: { title: "写入 README" },
});

describe("agent controller", () => {
	afterEach(() => {
		closeAllResumedAgentEventStreams();
		vi.useRealTimers();
		vi.mocked(createAgentEventSource).mockReset();
		vi.mocked(getAgentSessionStatus).mockReset();
		useAgentStore.getState().resetSession();
		useProjectStore.setState({ activeProjectId: null });
		useDocumentsStore.setState({
			activeDocumentId: "",
			documents: [],
			projectId: null,
			selection: null,
		});
	});

	it("scopes persisted session ids by project", () => {
		expect(agentSessionStorageKey("project-1")).toBe("mediago_drama_agent_session_project-1");
	});

	it("dedupes resumed event streams and closes them on demand", () => {
		const closeSpy = vi.fn();
		vi.mocked(createAgentEventSource).mockImplementation(
			() =>
				({
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					close: closeSpy,
					isClosed: () => false,
				}) as unknown as ReturnType<typeof createAgentEventSource>,
		);

		resumeAgentSessionEventStream("session-9", "project-9");
		resumeAgentSessionEventStream("session-9", "project-9");
		expect(createAgentEventSource).toHaveBeenCalledTimes(1);

		closeResumedAgentEventStream("session-9", "project-9");
		expect(closeSpy).toHaveBeenCalledTimes(1);

		resumeAgentSessionEventStream("session-9", "project-9");
		resumeAgentSessionEventStream("session-8", "project-9");
		expect(createAgentEventSource).toHaveBeenCalledTimes(3);

		closeAllResumedAgentEventStreams();
		expect(closeSpy).toHaveBeenCalledTimes(3);

		// The registry is empty again, so the same session can be resumed.
		resumeAgentSessionEventStream("session-9", "project-9");
		expect(createAgentEventSource).toHaveBeenCalledTimes(4);
	});

	it("removes pending permission dialogs when a permissionResolved event arrives", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.getState().addPermissionRequest(pendingRequest("permission-1"));

		handleStreamingAgentEvent(
			acpEvent({
				kind: "permissionResolved",
				status: "selected",
				permissionRequest: { requestId: "permission-1", options: [] },
			}),
			eventContext(),
		);

		expect(useAgentStore.getState().permissionRequests).toEqual([]);
	});

	it("records a visible activity when a permission request expires", () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.getState().addPermissionRequest(pendingRequest("permission-1"));

		handleStreamingAgentEvent(
			acpEvent({
				kind: "permissionResolved",
				status: "expired",
				permissionRequest: { requestId: "permission-1", options: [] },
			}),
			eventContext(),
		);

		expect(useAgentStore.getState().permissionRequests).toEqual([]);
		expect(useAgentStore.getState().activity).toEqual(
			expect.arrayContaining([expect.objectContaining({ label: "权限请求超时" })]),
		);
	});

	it("reconciles stale replayed permission requests after replay completes", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({ sessionId: "session-1" });
		// Replay re-added a request the backend already resolved.
		useAgentStore.getState().addPermissionRequest(pendingRequest("zombie-1"));
		useAgentStore.getState().addPermissionRequest(pendingRequest("permission-2"));
		vi.mocked(getAgentSessionStatus).mockResolvedValue({
			sessionId: "session-1",
			running: true,
			pendingPermissions: [pendingRequest("permission-2")],
		});

		handleStreamingAgentEvent(
			{
				id: "event-2",
				sessionId: "session-1",
				type: "agent.session.replay.completed",
				message: "",
				createdAt: new Date().toISOString(),
			},
			eventContext(),
		);

		expect(getAgentSessionStatus).toHaveBeenCalledWith("session-1", "project-1");
		await vi.waitFor(() => {
			expect(
				useAgentStore.getState().permissionRequests.map((request) => request.requestId),
			).toEqual(["permission-2"]);
		});
	});

	it("batches assistant deltas and flushes them before completion", () => {
		vi.useFakeTimers();
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.getState().startRun("问题");
		const context = eventContext();

		handleStreamingAgentEvent(
			{
				id: "event-started",
				sessionId: "session-1",
				type: "agent.run.started",
				runId: "run-1",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);
		handleStreamingAgentEvent(
			{
				id: "event-delta-1",
				sessionId: "session-1",
				type: "agent.message.delta",
				runId: "run-1",
				delta: "你",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);
		handleStreamingAgentEvent(
			{
				id: "event-delta-2",
				sessionId: "session-1",
				type: "agent.message.delta",
				runId: "run-1",
				delta: "好",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);

		expect(
			selectAgentMessages(useAgentStore.getState()).some((message) => message.content === "你好"),
		).toBe(false);

		handleStreamingAgentEvent(
			{
				id: "event-completed",
				sessionId: "session-1",
				type: "agent.message.completed",
				runId: "run-1",
				content: "",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "assistant",
					content: "你好",
					status: "complete",
				}),
			]),
		);
	});

	it("re-binds a hydrated pending-root run so resumed live events are not stranded", () => {
		vi.useFakeTimers();
		useProjectStore.setState({ activeProjectId: "project-1" });
		// A transcript hydrate during a live run (e.g. resume/reconnect): the backend
		// chat state carries no runId, so the store collapses onto the placeholder.
		useAgentStore.getState().hydrateAgentChatState(
			[
				{
					id: "user-1",
					role: "user",
					content: "重构这个函数",
					kind: "message",
					createdAt: "2026-06-27T00:00:00.000Z",
					status: "complete",
				},
			],
			[],
			{ sessionId: "session-1", running: true },
		);
		expect(useAgentStore.getState().rootRunId).toBe(pendingRootRunId);

		const context = eventContext();
		handleStreamingAgentEvent(
			{
				id: "event-delta",
				sessionId: "session-1",
				type: "agent.message.delta",
				runId: "run-real",
				delta: "好的",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);

		// The placeholder is re-bound synchronously, so the live run id owns the
		// active conversation rather than stranding updates under a second run.
		expect(useAgentStore.getState().rootRunId).toBe("run-real");

		handleStreamingAgentEvent(
			{
				id: "event-completed",
				sessionId: "session-1",
				type: "agent.message.completed",
				runId: "run-real",
				content: "好的，我来重构。",
				message: "",
				createdAt: new Date().toISOString(),
			},
			context,
		);

		expect(selectAgentMessages(useAgentStore.getState())).toEqual([
			expect.objectContaining({ role: "user", content: "重构这个函数" }),
			expect.objectContaining({ role: "assistant", content: "好的，我来重构。" }),
		]);
		expect(Object.keys(useAgentStore.getState().conversations)).toEqual(["run-real"]);
	});

	it("keeps mentioned reference titles in the runtime prompt", async () => {
		useProjectStore.setState({ activeProjectId: "project-1" });
		useDocumentsStore.setState({
			activeDocumentId: testDocument.id,
			documents: [testDocument],
			projectId: "project-1",
		});
		const send = vi.fn(async () => {
			useAgentStore.getState().finishRun();
			return { accepted: true };
		});
		vi.mocked(connectRemoteAgentRuntime).mockResolvedValue({
			sessionId: "session-1",
			send,
			isClosed: () => false,
			close: vi.fn(),
		});

		await runAgentPrompt("这个文档讲了什么", {
			references: [
				{
					kind: "asset",
					documentId: "asset-1",
					assetId: "asset-1",
					assetKind: "text",
					mimeType: "text/plain",
					title: "完美世界.txt",
					category: "reference",
					url: "/api/v1/projects/project-1/assets/asset-1/content",
				},
			],
		});

		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "@完美世界.txt 这个文档讲了什么",
			}),
		);
	});
});
