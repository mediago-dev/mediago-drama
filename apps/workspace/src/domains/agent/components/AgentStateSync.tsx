import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
	agentChatKey,
	getAgentChatState,
	getAgentSessionStatus,
	type AgentSessionStatus,
} from "@/domains/agent/api/agent";
import { refreshAgentChatTranscript } from "@/domains/agent/lib/chat-sync";
import {
	closeAllResumedAgentEventStreams,
	resumeAgentSessionEventStream,
} from "@/domains/agent/lib/controller";
import {
	getPersistedAgentSessionId,
	setPersistedAgentSessionId,
	useAgentPersistenceStore,
} from "@/domains/agent/stores/persistence";
import { readAgentChatCache, writeAgentChatCache } from "@/domains/agent/stores/chat-cache";
import { selectAgentSessionId, useAgentStore } from "@/domains/agent/stores";

interface AgentStateSyncProps {
	projectId?: string | null;
	routeSessionId?: string | null;
	workspaceReady?: boolean;
}

export const AgentStateSync: React.FC<AgentStateSyncProps> = ({
	projectId,
	routeSessionId,
	workspaceReady = true,
}) => {
	const activeSessionId = useAgentStore(selectAgentSessionId);
	const persistedSessionId = useAgentPersistenceStore((state) =>
		projectId ? (state.sessionIdsByProject[projectId] ?? null) : null,
	);
	const [persistenceHydrated, setPersistenceHydrated] = useState(() =>
		useAgentPersistenceStore.persist.hasHydrated(),
	);
	const sessionIdForLoad =
		(routeSessionId || activeSessionId || persistedSessionId)?.trim() || null;
	const canLoadChat = workspaceReady && (persistenceHydrated || Boolean(routeSessionId?.trim()));
	const swrKey = projectId && canLoadChat ? agentChatKey(projectId, sessionIdForLoad) : null;
	const { data } = useSWR(swrKey, async () => {
		const requestedProjectId = projectId?.trim() || null;
		const requestedSessionId = sessionIdForLoad;
		const state = await getAgentChatState(requestedProjectId, requestedSessionId);
		return {
			...state,
			__requestProjectId: requestedProjectId,
			__requestSessionId: requestedSessionId,
		};
	});
	const loadedRequestKey = useRef<string | null>(null);
	const inactiveNoticeSessionId = useRef<string | null>(null);

	useEffect(() => {
		if (useAgentPersistenceStore.persist.hasHydrated()) {
			setPersistenceHydrated(true);
		}
		return useAgentPersistenceStore.persist.onFinishHydration(() => {
			setPersistenceHydrated(true);
		});
	}, []);

	useEffect(() => {
		loadedRequestKey.current = null;
		inactiveNoticeSessionId.current = null;
		useAgentStore.getState().resetSession();
		// Refreshing the Tauri webview wipes the in-memory transcript. Restore the
		// last cached snapshot for this project so history shows immediately, even
		// before (or without) the backend chat fetch resolving. The SWR hydration
		// below overwrites it with authoritative data once it arrives.
		const cached = projectId ? readAgentChatCache(projectId) : null;
		if (cached) {
			useAgentStore.getState().hydrateAgentChatState([], cached.activity, {
				sessionId: cached.sessionId,
				rootRunId: cached.rootRunId,
				conversations: cached.conversations,
				lastEventId: cached.lastEventId,
				running: false,
			});
		} else {
			useAgentStore.getState().hydrateAgentChatState([], []);
		}
		// Resumed streams belong to the project being left; without this they
		// keep reconnecting until a terminal event happens to arrive.
		return () => {
			closeAllResumedAgentEventStreams();
		};
	}, [projectId]);

	useEffect(() => {
		if (!projectId) return;
		// Persist a debounced snapshot of the transcript so it survives a refresh.
		// Skip while a run is streaming (volatile state, high write frequency) and
		// skip empty states so an uninitialized store never clobbers a good cache.
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			timeout = undefined;
			const state = useAgentStore.getState();
			if (state.isRunning) return;
			if (Object.keys(state.conversations).length === 0 && !state.sessionId) return;
			writeAgentChatCache({
				projectId,
				sessionId: state.sessionId,
				rootRunId: state.rootRunId,
				lastEventId: state.lastEventId,
				conversations: state.conversations,
				activity: state.activity,
				updatedAt: new Date().toISOString(),
			});
		};
		const unsubscribe = useAgentStore.subscribe(() => {
			if (timeout !== undefined) clearTimeout(timeout);
			timeout = setTimeout(flush, 500);
		});
		return () => {
			if (timeout !== undefined) clearTimeout(timeout);
			unsubscribe();
		};
	}, [projectId]);

	useEffect(() => {
		if (!data) return;
		const requestedProjectId = data.__requestProjectId;
		if (requestedProjectId && projectId && requestedProjectId !== projectId) return;
		if (requestedProjectId && data.projectId && data.projectId !== requestedProjectId) return;
		const requestedSessionId = data.__requestSessionId;
		const resolvedSessionId = data.sessionId?.trim() || requestedSessionId;
		if (requestedSessionId && resolvedSessionId && requestedSessionId !== resolvedSessionId) return;
		const requestKey = agentStateSyncRequestKey(requestedProjectId, requestedSessionId);
		if (loadedRequestKey.current === requestKey) return;

		useAgentStore.getState().hydrateAgentChatState(data.messages, data.activity, {
			sessionId: resolvedSessionId,
			rootRunId: data.rootRunId,
			conversations: data.conversations,
			lastEventId: data.lastEventId,
			running: data.running,
			pendingPermissions: data.pendingPermissions,
		});
		if (requestedProjectId && resolvedSessionId) {
			setPersistedAgentSessionId(requestedProjectId, resolvedSessionId);
		}
		if (requestedProjectId && resolvedSessionId && data.running) {
			resumeAgentSessionEventStream(resolvedSessionId, requestedProjectId, data.lastEventId);
		}
		loadedRequestKey.current = requestKey;
	}, [data, projectId]);

	useEffect(() => {
		if (!projectId || !loadedRequestKey.current) return;

		const sessionId =
			routeSessionId?.trim() ||
			persistedSessionId?.trim() ||
			useAgentStore.getState().sessionId?.trim() ||
			getPersistedAgentSessionId(projectId);
		if (!sessionId) return;
		if (inactiveNoticeSessionId.current === sessionId) return;

		let cancelled = false;
		getAgentSessionStatus(sessionId, projectId)
			.then((status) => {
				const currentSessionId = useAgentStore.getState().sessionId?.trim() || null;
				if (cancelled || (currentSessionId && currentSessionId !== sessionId)) {
					return;
				}

				const store = useAgentStore.getState();
				if (!status.running) {
					applyTerminalSessionStatus(status);
					void refreshAgentChatTranscript(sessionId, projectId).catch(() => {});
				}

				if (
					inactiveNoticeSessionId.current !== sessionId &&
					(status.lastStatus === "interrupted" || status.lastStatus === "paused")
				) {
					inactiveNoticeSessionId.current = sessionId;
					store.setSessionId(sessionId);
					store.recordActivity(
						"runtime",
						status.lastStatus === "paused" ? "上次运行已暂停" : "上次运行中断",
						status.lastMessage
							? `上次有未完成的 run，已在重启后标记为非运行状态。${status.lastMessage}`
							: "上次有未完成的 run，已在重启后标记为非运行状态；不会自动重启 ACP，可重新发起或忽略。",
					);
				}
			})
			.catch((error) => {
				// Recovery is best-effort; regular chat hydration remains the source of history.
				if (!cancelled && import.meta.env.DEV) {
					console.debug("[agent] failed to recover inactive session status", error);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [data, persistenceHydrated, persistedSessionId, projectId, routeSessionId]);

	return null;
};

const agentStateSyncRequestKey = (projectId?: string | null, sessionId?: string | null) =>
	`${projectId ?? ""}\u0000${sessionId ?? ""}`;

const applyTerminalSessionStatus = (status: AgentSessionStatus) => {
	const store = useAgentStore.getState();
	const message = status.lastMessage?.trim();
	switch (status.lastStatus) {
		case "cancelled":
			store.cancelRun(message || "智能体运行已中断。");
			return;
		case "failed":
			store.failRun(message || "智能体运行失败。");
			return;
		case "interrupted":
		case "paused":
			store.cancelRun(message || "上次运行已因应用重启暂停。");
			return;
		default:
			if (!store.isRunning) return;
			store.recordActivity("runtime", "状态已同步", message || "后端运行已结束，已释放输入框。");
			store.finishRun();
	}
};
