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
	shouldPreserveLocalTranscript,
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
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
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
	const fallbackSessionId = persistedSessionId?.trim() || null;
	const sessionIdForLoad = routeSessionIdForLoad || latestSessionId || fallbackSessionId;
	// A failed session list must not strand the panel waiting on persistence
	// hydration: once the lookup settles (success OR error) we can still load the
	// latest chat via the fallback session id — or a null id, which the backend
	// resolves to the latest session — so a transient list outage self-heals.
	const canLoadWithoutPersistence =
		Boolean(routeSessionIdForLoad) || (shouldLoadLatestSession && latestSessionLookupSettled);
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
		// The server transcript is the single source of truth: reset to an empty
		// timeline and let the SWR fetch below hydrate it. `isChatHydrating` drives a
		// loading state for the brief fetch instead of restoring a stale local cache.
		useAgentStore.getState().resetSession();
		// Resumed streams belong to the project being left; without this they
		// keep reconnecting until a terminal event happens to arrive.
		return () => {
			closeAllResumedAgentEventStreams();
		};
	}, [projectId]);

	const isChatHydrating = Boolean(swrKey) && !data;
	useEffect(() => {
		useAgentStore.setState({ isChatHydrating });
	}, [isChatHydrating]);

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
		const preserveLocalTranscript = shouldPreserveLocalTranscript({
			isRunning: agentStore.isRunning,
			appliedLastEventId: agentStore.lastEventId,
			localMessageCount: selectAgentMessages(agentStore).length,
			snapshotLastEventId: data.lastEventId,
			snapshotIsEmpty:
				data.messages.length === 0 && Object.keys(data.conversations ?? {}).length === 0,
		});
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
		// Resume the live stream when the run is in flight. A run blocked on a
		// pending permission can momentarily report running:false while still
		// needing live events for the decision and its aftermath — both states
		// guarantee a future terminal event, so the stream self-closes and never
		// leaks on a genuinely idle session.
		const shouldResumeStream = data.running || (data.pendingPermissions?.length ?? 0) > 0;
		if (requestedProjectId && resolvedSessionId && shouldResumeStream) {
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
	// A transient session-list / chat fetch failure should self-heal rather than
	// leave the panel empty; retry a bounded number of times with a short backoff.
	shouldRetryOnError: true,
	errorRetryCount: 5,
	errorRetryInterval: 3000,
} as const;

const firstAgentSessionId = (sessions?: AgentSessionSummary[]) =>
	sessions?.find((session) => session.sessionId.trim())?.sessionId.trim() || null;

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
