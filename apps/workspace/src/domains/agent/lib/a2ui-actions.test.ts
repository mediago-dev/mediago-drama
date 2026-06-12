import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAgentPermission } from "@/domains/agent/api/agent";
import { selectAgentMessages, type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { handleDeterministicA2UIAction } from "./a2ui-actions";

const mocks = vi.hoisted(() => ({
	decideAgentPermission: vi.fn(),
	decideDocumentToolApproval: vi.fn(),
}));

vi.mock("@/domains/agent/api/agent", () => mocks);

describe("handleDeterministicA2UIAction", () => {
	afterEach(() => {
		vi.mocked(decideAgentPermission).mockReset();
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
