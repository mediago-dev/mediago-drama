import type React from "react";
import { useEffect, useRef, useState } from "react";
import { type Location, useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";
import {
	agentChatKey,
	agentSessionsKey,
	getAgentChatState,
	getAgentSessionStatus,
	listAgentSessions,
	type AgentSessionStatus,
	type AgentSessionSummary,
} from "@/domains/agent/api/agent";
import {
	refreshAgentChatTranscript,
	transcriptDropsLocalContext,
} from "@/domains/agent/lib/chat-sync";
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
import { selectAgentMessages, useAgentStore, type AgentState } from "@/domains/agent/stores";
import {
	agentProjectPath,
	agentProjectRouteState,
	isAgentRoute,
} from "@/domains/workspace/lib/workbench-route";

interface AgentStateSyncProps {
	agentSurfaceActive?: boolean;
	projectId?: string | null;
	routeSessionId?: string | null;
}

export const AgentStateSync: React.FC<AgentStateSyncProps> = ({
	agentSurfaceActive = true,
	projectId,
	routeSessionId,
}) => {
	const location = useLocation();
	const navigate = useNavigate();
	const normalizedProjectId = projectId?.trim() || null;
	const routeVisitRef = useRef<{ projectId: string | null; key: string }>({
		projectId: null,
		key: "",
	});
	if (routeVisitRef.current.projectId !== normalizedProjectId) {
		routeVisitRef.current = {
			projectId: normalizedProjectId,
			key: normalizedProjectId ? agentRecoveryRouteVisitKey(location) : "",
		};
	}
	const routeVisitKey = routeVisitRef.current.key;
	const persistedSessionId = useAgentPersistenceStore((state) =>
		projectId ? (state.sessionIdsByProject[projectId] ?? null) : null,
	);
	const cachedSessionId = projectId
		? readAgentChatCache(projectId)?.sessionId?.trim() || null
		: null;
	const [persistenceHydrated, setPersistenceHydrated] = useState(() =>
		useAgentPersistenceStore.persist.hasHydrated(),
	);
	const routeSessionIdForLoad = routeSessionId?.trim() || null;
	const shouldLoadLatestSession = Boolean(
		projectId && agentSurfaceActive && !routeSessionIdForLoad,
	);
	const {
		data: latestSessions,
		error: latestSessionsError,
		isLoading: latestSessionsLoading,
	} = useSWR(
		shouldLoadLatestSession
			? agentRouteScopedSWRKey(agentSessionsKey(projectId), routeVisitKey)
			: null,
		() => listAgentSessions(projectId),
		agentRecoverySWRConfig,
	);
	const latestSessionLookupSettled =
		!shouldLoadLatestSession ||
		Boolean(latestSessions) ||
		Boolean(latestSessionsError) ||
		latestSessionsLoading === false;
	const latestSessionId = latestSessionsError ? null : firstAgentSessionId(latestSessions);
	const fallbackSessionId = persistedSessionId?.trim() || cachedSessionId;
	const sessionIdForLoad = routeSessionIdForLoad || latestSessionId || fallbackSessionId;
	const canLoadWithoutPersistence =
		Boolean(routeSessionIdForLoad) ||
		(shouldLoadLatestSession && latestSessionLookupSettled && !latestSessionsError);
	const canLoadChat =
		(canLoadWithoutPersistence || persistenceHydrated) &&
		(!shouldLoadLatestSession || latestSessionLookupSettled);
	const swrKey =
		projectId && canLoadChat
			? agentRouteScopedSWRKey(agentChatKey(projectId, sessionIdForLoad), routeVisitKey)
			: null;
	const { data } = useSWR(
		swrKey,
		async () => {
			const requestedProjectId = projectId?.trim() || null;
			const requestedSessionId = sessionIdForLoad;
			const state = await getAgentChatState(requestedProjectId, requestedSessionId);
			return {
				...state,
				__requestProjectId: requestedProjectId,
				__requestSessionId: requestedSessionId,
			};
		},
		agentRecoverySWRConfig,
	);
	const loadedRequestKey = useRef<string | null>(null);
	const inactiveNoticeSessionId = useRef<string | null>(null);
	const latestSessionUrlTarget =
		agentSurfaceActive && !routeSessionIdForLoad && latestSessionLookupSettled
			? sessionIdForLoad
			: null;

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
		const store = useAgentStore.getState();
		store.resetSession();
		// Restore this project's cached transcript synchronously instead of blanking the
		// panel: re-entering a project then shows the last-known messages immediately while
		// the SWR fetch below revalidates, rather than flashing an empty timeline.
		const cached = projectId ? readAgentChatCache(projectId) : null;
		if (cached) {
			store.hydrateAgentChatState([], cached.activity, {
				sessionId: cached.sessionId,
				rootRunId: cached.rootRunId,
				conversations: cached.conversations,
				lastEventId: cached.lastEventId,
				running: false,
			});
		} else {
			store.hydrateAgentChatState([], []);
		}
		// Resumed streams belong to the project being left; without this they
		// keep reconnecting until a terminal event happens to arrive.
		return () => {
			closeAllResumedAgentEventStreams();
		};
	}, [projectId]);

	useEffect(() => {
		if (!projectId || loadedRequestKey.current) return;

		const cached = readAgentChatCache(projectId);
		if (!cached) return;

		const cachedSessionId = cached.sessionId?.trim() || null;
		const targetSessionId = sessionIdForLoad;
		if (targetSessionId && cachedSessionId !== targetSessionId) return;

		// Refreshing the desktop webview wipes the in-memory transcript. Restore a
		// cached snapshot only when it matches the session selected for this route;
		// the SWR hydration below overwrites it with authoritative data once it arrives.
		useAgentStore.getState().hydrateAgentChatState([], cached.activity, {
			sessionId: cached.sessionId,
			rootRunId: cached.rootRunId,
			conversations: cached.conversations,
			lastEventId: cached.lastEventId,
			running: false,
		});
	}, [latestSessionId, projectId, routeSessionIdForLoad, sessionIdForLoad]);

	useEffect(() => {
		if (!agentSurfaceActive || !projectId || routeSessionIdForLoad || !latestSessionUrlTarget) {
			return;
		}
		if (!isAgentRoute(location.pathname)) return;
		const nextUrl = agentProjectPath(projectId, { agentSessionId: latestSessionUrlTarget });
		if (nextUrl === `${location.pathname}${location.search}`) return;
		navigate(nextUrl, { replace: true, state: agentProjectRouteState("agent") });
	}, [
		agentSurfaceActive,
		latestSessionUrlTarget,
		location.pathname,
		location.search,
		navigate,
		projectId,
		routeSessionIdForLoad,
	]);

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
			if (!hasCacheableAgentSnapshot(state)) return;
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
			flush();
			unsubscribe();
		};
	}, [projectId]);

	useEffect(() => {
		if (!data) return;
		const currentProjectId = projectId?.trim() || null;
		if (!currentProjectId) return;
		const requestedProjectId = data.__requestProjectId?.trim() || null;
		if (requestedProjectId !== currentProjectId) return;
		const responseProjectId = data.projectId?.trim() || null;
		if (responseProjectId && responseProjectId !== currentProjectId) return;
		const requestedSessionId = data.__requestSessionId;
		const resolvedSessionId = data.sessionId?.trim() || requestedSessionId;
		if (requestedSessionId && resolvedSessionId && requestedSessionId !== resolvedSessionId) return;
		const requestKey = agentStateSyncRequestKey(
			requestedProjectId,
			requestedSessionId,
			resolvedSessionId,
			data.lastEventId,
			data.updatedAt,
			data.running ? "running" : "idle",
			String(data.messages.length),
			String(Object.keys(data.conversations ?? {}).length),
		);
		if (loadedRequestKey.current === requestKey) return;

		const agentStore = useAgentStore.getState();
		const localMessages = selectAgentMessages(agentStore);
		const preserveLocalTranscript =
			shouldPreserveLocalRunningTranscript(data, agentStore, resolvedSessionId) ||
			transcriptDropsLocalContext(localMessages, data.messages);
		if (preserveLocalTranscript) {
			if (resolvedSessionId) agentStore.setSessionId(resolvedSessionId);
		} else {
			agentStore.hydrateAgentChatState(data.messages, data.activity, {
				sessionId: resolvedSessionId,
				rootRunId: data.rootRunId,
				conversations: data.conversations,
				lastEventId: data.lastEventId,
				running: data.running,
				pendingPermissions: data.pendingPermissions,
			});
		}
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

const agentStateSyncRequestKey = (...parts: Array<string | null | undefined>) =>
	parts.map((part) => part ?? "").join("\u0000");

const agentRecoveryRouteVisitKey = (location: Location) =>
	agentStateSyncRequestKey(location.key || "default", location.pathname, location.search);

const agentRouteScopedSWRKey = (resourceKey: string, routeVisitKey: string) =>
	agentStateSyncRequestKey(resourceKey, routeVisitKey);

const agentRecoverySWRConfig = {
	dedupingInterval: 0,
	revalidateIfStale: true,
	revalidateOnFocus: false,
	revalidateOnMount: true,
} as const;

const firstAgentSessionId = (sessions?: AgentSessionSummary[]) =>
	sessions?.find((session) => session.sessionId.trim())?.sessionId.trim() || null;

const hasCacheableAgentSnapshot = (
	state: Pick<AgentState, "activity" | "conversations">,
): boolean =>
	state.activity.length > 0 ||
	Object.values(state.conversations).some((conversation) => {
		if (conversation.prompt?.trim()) return true;
		return conversation.messages.some((message) => {
			if (message.content.trim() || message.title?.trim()) return true;
			return Boolean(message.metadata && Object.keys(message.metadata).length > 0);
		});
	});

const shouldPreserveLocalRunningTranscript = (
	data: {
		running?: boolean;
		messages: readonly unknown[];
		conversations?: Record<string, unknown> | null;
	},
	state: AgentState,
	resolvedSessionId?: string | null,
): boolean => {
	if (!data.running) return false;
	if (data.messages.length > 0) return false;
	if (Object.keys(data.conversations ?? {}).length > 0) return false;
	if (selectAgentMessages(state).length === 0) return false;

	const localSessionId = state.sessionId?.trim() || null;
	const targetSessionId = resolvedSessionId?.trim() || null;
	if (localSessionId && targetSessionId && localSessionId !== targetSessionId) return false;
	if (!localSessionId && targetSessionId && !state.isRunning) return false;
	return true;
};

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
