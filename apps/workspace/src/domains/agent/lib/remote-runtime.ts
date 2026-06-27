import {
	createAgentEventSource,
	createAgentSession,
	sendAgentMessage,
	type AgentMessageRequest,
	type AgentMessageAccepted,
	type AgentRuntimeEvent,
} from "@/domains/agent/api/agent";
import type { ManagedEventSource } from "@/shared/lib/sse/managed-event-source";

type RemoteAgentRuntimeSendRequest = Omit<AgentMessageRequest, "sessionId">;
export interface RemoteAgentRuntimeEventMeta {
	replay: boolean;
}

export interface RemoteAgentRuntimeConnection {
	sessionId: string;
	send: (request: RemoteAgentRuntimeSendRequest) => Promise<AgentMessageAccepted>;
	isClosed: () => boolean;
	close: () => void;
}

export const runtimeEventTypes = [
	"agent.user.message",
	"agent.session.replay.completed",
	"agent.message.accepted",
	"agent.run.started",
	"agent.activity",
	"agent.acp",
	"agent.message.delta",
	"agent.message.completed",
	"agent.ui",
	"agent.patch.proposed",
	"agent.document.edit.started",
	"agent.document.edit.delta",
	"agent.document.edit.checkpoint",
	"agent.document.edit.completed",
	"agent.document.edit.failed",
	"agent.document.selection.set",
	"agent.run.cancelled",
	"agent.run.failed",
	"agent.run.completed",
] as const satisfies readonly AgentRuntimeEvent["type"][];

export const connectRemoteAgentRuntime = async (
	onEvent: (event: AgentRuntimeEvent, meta: RemoteAgentRuntimeEventMeta) => void,
	preferredSessionId?: string | null,
	projectId?: string | null,
	afterEventId?: string | null,
): Promise<RemoteAgentRuntimeConnection> => {
	const sessionId = preferredSessionId || (await createAgentSession(projectId)).sessionId;
	const eventSource = createAgentEventSource(sessionId, projectId, afterEventId);
	const parseEvent = (event: MessageEvent) => JSON.parse(event.data) as AgentRuntimeEvent;
	const eventListeners = new Map<string, (event: MessageEvent) => void>();
	let replaying = true;

	for (const eventType of runtimeEventTypes) {
		const listener = (event: MessageEvent) => {
			const parsed = parseEvent(event);
			onEvent(parsed, { replay: replaying });
			if (parsed.type === "agent.session.replay.completed" && parsed.sessionId === sessionId) {
				replaying = false;
			}
		};
		eventListeners.set(eventType, listener);
		eventSource.addEventListener(eventType, listener);
	}

	await waitForAgentEventStream(eventSource, sessionId, onEvent, parseEvent);

	return {
		sessionId,
		send: async (request) => {
			return sendAgentMessage({ sessionId, ...request }, projectId);
		},
		isClosed: () => eventSource.isClosed(),
		close: () => {
			for (const [eventType, listener] of eventListeners) {
				eventSource.removeEventListener(eventType, listener);
			}
			eventListeners.clear();
			eventSource.close();
		},
	};
};

// Resolves once the stream is established (the server's `agent.session.connected`
// is written before history replay), so callers can send immediately. Replay
// keeps streaming in the background and the `replaying` flag (tracked in
// connectRemoteAgentRuntime) still gates replayed lifecycle events. The 5s
// timeout now only guards a connection that never establishes — it no longer
// trips on a slow/large history replay, which previously tore the stream down
// and surfaced as an interrupted run.
const waitForAgentEventStream = (
	eventSource: ManagedEventSource,
	_sessionId: string,
	onEvent: (event: AgentRuntimeEvent, meta: RemoteAgentRuntimeEventMeta) => void,
	parseEvent: (event: MessageEvent) => AgentRuntimeEvent,
) =>
	new Promise<void>((resolve, reject) => {
		let settled = false;
		const timeout = window.setTimeout(() => {
			if (settled) return;
			settled = true;
			eventSource.removeEventListener("agent.session.connected", handleConnected);
			eventSource.close();
			reject(new Error("连接本地智能体事件流超时。"));
		}, 5000);

		function handleConnected(event: MessageEvent) {
			const parsed = parseEvent(event);
			onEvent(parsed, { replay: false });
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			eventSource.removeEventListener("agent.session.connected", handleConnected);
			resolve();
		}

		eventSource.addEventListener("agent.session.connected", handleConnected);
	});
