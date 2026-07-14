import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAgentPermission, decideAgentSelection } from "@/domains/agent/api/agent";
import { selectAgentMessages, type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { handleDeterministicA2UIAction } from "./a2ui-actions";

const mocks = vi.hoisted(() => ({
	decideAgentPermission: vi.fn(),
	decideAgentSelection: vi.fn(),
	decideDocumentToolApproval: vi.fn(),
}));

vi.mock("@/domains/agent/api/agent", () => mocks);

describe("handleDeterministicA2UIAction", () => {
	afterEach(() => {
		vi.mocked(decideAgentPermission).mockReset();
		vi.mocked(decideAgentSelection).mockReset();
		useAgentStore.getState().resetSession();
		useAgentStore.setState({
			activity: [],
			conversations: {},
			isRunning: false,
			permissionRequests: [],
			rootRunId: null,
			runtimeAlerts: [],
			streamingMessageId: null,
		});
		useProjectStore.setState({ activeProjectId: null });
		useAgentPersistenceStore.setState({ resolvedSelections: {} });
	});

	it("replaces a confirmed permission UI with the selected decision summary", async () => {
		vi.mocked(decideAgentPermission).mockResolvedValue({} as never);
		const message = permissionMessage();
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			sessionId: "session-1",
			rootRunId: "run-1",
			conversations: {
				"run-1": {
					runId: "run-1",
					name: "主智能体",
					status: "running",
					messages: [message],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-06-08T10:00:00.000Z",
					updatedAt: "2026-06-08T10:00:00.000Z",
				},
			},
			permissionRequests: [
				{
					requestId: "permission-1",
					options: [{ optionId: "allow-once", kind: "allow_once", name: "Allow once" }],
					toolCall: { title: "execute", kind: "execute" },
				},
			],
		});

		const handled = await handleDeterministicA2UIAction(message, {
			name: "agent.permission.decide",
			context: {
				kind: "agent_permission",
				optionId: "allow-once",
				requestId: "permission-1",
			},
			sourceComponentId: "permission-option-allow-once",
			surfaceId: "agent-permission-permission-1",
			timestamp: "2026-06-08T10:00:01.000Z",
		} satisfies A2uiClientAction);

		expect(handled).toBe(true);
		expect(decideAgentPermission).toHaveBeenCalledWith({
			cancelled: false,
			optionId: "allow-once",
			projectId: "project-1",
			requestId: "permission-1",
			sessionId: "session-1",
		});
		const state = useAgentStore.getState();
		const messages = selectAgentMessages(state);
		expect(state.permissionRequests).toHaveLength(0);
		expect(messages[0]).toMatchObject({
			id: "permission-ui",
			content: "用户已允许一次。",
			kind: "message",
			title: "工具权限",
			metadata: {
				permissionDecision: {
					cancelled: false,
					optionId: "allow-once",
					requestId: "permission-1",
				},
			},
		});
		expect(messages[0]?.metadata?.a2ui).toBeUndefined();
	});

	it("replaces a selection UI with the picked option label", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "选择一种插画风格",
			options: [
				{ id: "sweet", label: "甜美粉彩" },
				{ id: "retro", label: "复古线条", imageUrl: "https://x/retro.png" },
			],
			allowCustom: true,
			status: "selected",
			decision: { optionId: "retro" },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = selectionMessage();
		useProjectStore.setState({ activeProjectId: "project-1" });
		seedConversation(message);

		const handled = await handleDeterministicA2UIAction(message, {
			name: "agent_selection.decide",
			context: {
				kind: "agent_selection",
				projectId: "project-1",
				selectionId: "selection-1",
				optionId: "retro",
			},
			sourceComponentId: "opt-btn-1",
			surfaceId: "agent-selection-selection-1",
			timestamp: "2026-06-08T10:00:01.000Z",
		} satisfies A2uiClientAction);

		expect(handled).toBe(true);
		expect(decideAgentSelection).toHaveBeenCalledWith(
			"selection-1",
			{ optionId: "retro" },
			"project-1",
		);
		const messages = selectAgentMessages(useAgentStore.getState());
		expect(messages[0]).toMatchObject({
			id: "selection-ui",
			content: "已选择：复古线条",
			kind: "message",
			title: "选择一种插画风格",
			metadata: {
				selectionDecision: {
					optionId: "retro",
					selectionId: "selection-1",
					status: "selected",
				},
			},
		});
		expect(messages[0]?.metadata?.a2ui).toBeUndefined();
		// The decision persists (with the picked option's preview image) so the
		// card stays frozen across hydrates and still shows what was chosen.
		expect(useAgentPersistenceStore.getState().resolvedSelections["selection-1"]).toEqual({
			status: "selected",
			summary: "已选择：复古线条",
			title: "选择一种插画风格",
			imageUrl: "https://x/retro.png",
		});
	});

	it("marks a stale selection card with the persisted outcome", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "选择一种插画风格",
			options: [{ id: "sweet", label: "甜美粉彩" }],
			allowCustom: false,
			status: "expired",
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = selectionMessage();
		useProjectStore.setState({ activeProjectId: "project-1" });
		seedConversation(message);

		const handled = await handleDeterministicA2UIAction(message, {
			name: "agent_selection.decide",
			context: {
				kind: "agent_selection",
				projectId: "project-1",
				selectionId: "selection-1",
				optionId: "sweet",
			},
			sourceComponentId: "opt-btn-0",
			surfaceId: "agent-selection-selection-1",
			timestamp: "2026-06-08T10:00:01.000Z",
		} satisfies A2uiClientAction);

		expect(handled).toBe(true);
		const messages = selectAgentMessages(useAgentStore.getState());
		expect(messages[0]?.content).toBe("该选择已过期，请让 Agent 重新发起。");
		expect(useAgentStore.getState().activity[0]?.label).toBe("选择已过期");
	});

	it("records cancellation as cancelled instead of submitted", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "选择一种插画风格",
			options: [{ id: "sweet", label: "甜美粉彩" }],
			allowCustom: false,
			status: "cancelled",
			decision: { cancelled: true },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = selectionMessage();
		useProjectStore.setState({ activeProjectId: "project-1" });
		seedConversation(message);

		await handleDeterministicA2UIAction(message, {
			name: "agent_selection.decide",
			context: {
				cancelled: true,
				kind: "agent_selection",
				projectId: "project-1",
				selectionId: "selection-1",
			},
			sourceComponentId: "selection-cancel",
			surfaceId: "agent-selection-selection-1",
			timestamp: "2026-06-08T10:00:01.000Z",
		} satisfies A2uiClientAction);

		expect(decideAgentSelection).toHaveBeenCalledWith(
			"selection-1",
			{ cancelled: true },
			"project-1",
		);
		expect(useAgentStore.getState().activity[0]?.label).toBe("选择已取消");
	});

	it("records an error for an incomplete selection action without calling the API", async () => {
		const message = selectionMessage();
		useProjectStore.setState({ activeProjectId: "project-1" });
		seedConversation(message);

		const handled = await handleDeterministicA2UIAction(message, {
			name: "agent_selection.decide",
			context: {
				kind: "agent_selection",
				projectId: "project-1",
				selectionId: "selection-1",
			},
			sourceComponentId: "opt-btn-0",
			surfaceId: "agent-selection-selection-1",
			timestamp: "2026-06-08T10:00:01.000Z",
		} satisfies A2uiClientAction);

		expect(handled).toBe(true);
		expect(decideAgentSelection).not.toHaveBeenCalled();
		const state = useAgentStore.getState();
		expect(state.activity.some((item) => item.label === "选择提交失败")).toBe(true);
	});
});

const seedConversation = (message: AgentMessage) => {
	useAgentStore.setState({
		sessionId: "session-1",
		rootRunId: "run-1",
		conversations: {
			"run-1": {
				runId: "run-1",
				name: "主智能体",
				status: "running",
				messages: [message],
				streamingMessageId: null,
				children: [],
				createdAt: "2026-06-08T10:00:00.000Z",
				updatedAt: "2026-06-08T10:00:00.000Z",
			},
		},
	});
};

const selectionMessage = (): AgentMessage => ({
	id: "selection-ui",
	role: "assistant",
	content: "选择一种插画风格",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "agent-selection-selection-1",
			messages: [],
		},
	},
});

const permissionMessage = (): AgentMessage => ({
	id: "permission-ui",
	role: "assistant",
	content: "需要确认工具权限",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "agent-permission-permission-1",
			messages: [],
		},
	},
});
