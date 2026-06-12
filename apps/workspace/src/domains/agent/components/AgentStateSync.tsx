import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { agentChatKey, getAgentChatState, getAgentSessionStatus } from "@/domains/agent/api/agent";
import {
	closeAllResumedAgentEventStreams,
	resumeAgentSessionEventStream,
} from "@/domains/agent/lib/controller";
import {
	getPersistedAgentSessionId,
	setPersistedAgentSessionId,
} from "@/domains/agent/stores/persistence";
import { selectAgentSessionId, useAgentStore } from "@/domains/agent/stores";
import { useProjectStore } from "@/domains/projects/stores";

interface AgentStateSyncProps {
	projectId?: string | null;
}

export const AgentStateSync: React.FC<AgentStateSyncProps> = ({ projectId }) => {
	const activeSessionId = useAgentStore(selectAgentSessionId);
	const [storedSessionId, setStoredSessionId] = useState<string | null>(() =>
		projectId ? getPersistedAgentSessionId(projectId) : null,
	);
	const sessionIdForLoad = (activeSessionId || storedSessionId)?.trim() || null;
	const swrKey = projectId ? agentChatKey(projectId, sessionIdForLoad) : null;
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
	const hasLoaded = useRef(false);
	const inactiveNoticeSessionId = useRef<string | null>(null);

	useEffect(() => {
		hasLoaded.current = false;
		inactiveNoticeSessionId.current = null;
		useAgentStore.getState().resetSession();
		if (!projectId) {
			setStoredSessionId(null);
			useAgentStore.getState().hydrateAgentChatState([], []);
		} else {
			setStoredSessionId(getPersistedAgentSessionId(projectId));
			useAgentStore.getState().hydrateAgentChatState([], []);
		}
		// Resumed streams belong to the project being left; without this they
		// keep reconnecting until a terminal event happens to arrive.
		return () => {
			closeAllResumedAgentEventStreams();
		};
	}, [projectId]);

	useEffect(() => {
		if (!data || hasLoaded.current) return;
		const currentProjectId = useProjectStore.getState().activeProjectId;
		const requestedProjectId = data.__requestProjectId;
		if (requestedProjectId && currentProjectId && currentProjectId !== requestedProjectId) return;
		if (requestedProjectId && data.projectId && data.projectId !== requestedProjectId) return;
		const requestedSessionId = data.__requestSessionId;
		const resolvedSessionId = data.sessionId?.trim() || requestedSessionId;
		if (requestedSessionId && resolvedSessionId && requestedSessionId !== resolvedSessionId) return;

		useAgentStore.getState().hydrateAgentChatState(data.messages, data.activity, {
			sessionId: resolvedSessionId,
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
		hasLoaded.current = true;
	}, [data]);

	useEffect(() => {
		if (!projectId || !hasLoaded.current) return;

		const sessionId = getPersistedAgentSessionId(projectId);
		if (!sessionId) return;
		if (inactiveNoticeSessionId.current === sessionId) return;

		let cancelled = false;
		getAgentSessionStatus(sessionId, projectId)
			.then((status) => {
				const currentProjectId = useProjectStore.getState().activeProjectId;
				const currentSessionId = useAgentStore.getState().sessionId?.trim() || null;
				if (
					cancelled ||
					(currentProjectId && currentProjectId !== projectId) ||
					(currentSessionId && currentSessionId !== sessionId) ||
					(status.lastStatus !== "interrupted" && status.lastStatus !== "paused")
				) {
					return;
				}

				inactiveNoticeSessionId.current = sessionId;
				const store = useAgentStore.getState();
				store.setSessionId(sessionId);
				store.recordActivity(
					"runtime",
					status.lastStatus === "paused" ? "上次运行已暂停" : "上次运行中断",
					status.lastMessage
						? `上次有未完成的 run，已在重启后标记为非运行状态。${status.lastMessage}`
						: "上次有未完成的 run，已在重启后标记为非运行状态；不会自动重启 ACP，可重新发起或忽略。",
				);
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
	}, [data, projectId]);

	return null;
};
