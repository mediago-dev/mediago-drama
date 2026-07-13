import { getAgentSessionStatus } from "@/domains/agent/api/agent";
import { refreshAgentChatTranscript } from "@/domains/agent/lib/chat-sync";
import {
	debugAgentError,
	isCurrentAgentProject,
	refreshWorkspaceStateFromBackend,
} from "@/domains/agent/lib/runtime-shared";
import { useAgentStore } from "@/domains/agent/stores";

// Reconciles the local run state against the backend session status: applies
// terminal statuses the SSE stream may have missed and refreshes the
// authoritative transcript afterwards.

export const syncAgentSessionStatus = async (
	sessionId: string,
	projectId: string | null,
	options: { applyTerminal: boolean; settle?: () => void },
) => {
	const status = await getAgentSessionStatus(sessionId, projectId);
	const agentStore = useAgentStore.getState();
	logPendingPermissionStatus(status, options.applyTerminal ? "poll" : "connect");
	agentStore.syncPermissionRequests(status.pendingPermissions ?? []);
	if (status.running || !options.applyTerminal) return;

	if (status.lastStatus === "cancelled") {
		agentStore.cancelRun(status.lastMessage || "智能体运行已中断。");
	} else if (status.lastStatus === "interrupted" || status.lastStatus === "paused") {
		agentStore.cancelRun(status.lastMessage || "上次运行已因应用重启暂停。");
	} else if (status.lastStatus === "failed") {
		agentStore.failRun(status.lastMessage || "智能体运行失败。");
	} else if (agentStore.isRunning) {
		agentStore.recordActivity(
			"runtime",
			"状态已同步",
			status.lastMessage || "后端运行已结束，已释放输入框。",
		);
		void refreshWorkspaceStateFromBackend(projectId ?? undefined);
		agentStore.finishRun();
	}
	await refreshAgentChatTranscript(sessionId, projectId).catch((error) =>
		debugAgentError("failed to refresh transcript after session status sync", error),
	);
	if (!useAgentStore.getState().isRunning) {
		options.settle?.();
	}
};

const logPendingPermissionStatus = (status: { pendingPermissions?: unknown[] }, source: string) => {
	if (!import.meta.env.DEV) return;
	console.debug("[agent] session status pendingPermissions", {
		source,
		count: status.pendingPermissions?.length ?? 0,
	});
};

// Resolves when the streaming run settles. SSE is the primary completion
// signal; a 1s status poll unlocks the UI if a terminal event is missed.
export const waitForStreamingRun = (sessionId: string, projectId: string | null) =>
	new Promise<void>((resolve) => {
		let settled = false;
		let isPolling = false;
		let unsubscribe = () => {};
		let interval: number | undefined;
		const settle = () => {
			if (settled) return;
			settled = true;
			unsubscribe();
			if (interval !== undefined) window.clearInterval(interval);
			resolve();
		};
		const shouldResolve = () => {
			const state = useAgentStore.getState();
			return !state.isRunning;
		};
		unsubscribe = useAgentStore.subscribe((state) => {
			if (!state.isRunning) {
				settle();
			}
		});
		if (shouldResolve()) {
			settle();
			return;
		}

		const syncStatus = async () => {
			if (settled || isPolling) return;
			if (!isCurrentAgentProject(projectId)) {
				settle();
				return;
			}
			isPolling = true;
			try {
				await syncAgentSessionStatus(sessionId, projectId, { applyTerminal: true, settle });
			} catch {
				// SSE is the primary path; polling only unlocks the UI if a terminal event is missed.
			} finally {
				isPolling = false;
			}
		};

		interval = window.setInterval(() => {
			void syncStatus();
		}, 1000);
		void syncStatus();
	});
