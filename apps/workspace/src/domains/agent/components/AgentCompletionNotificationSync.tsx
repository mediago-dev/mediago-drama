import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	type AgentCompletionOutcome,
	showAgentCompletionSystemNotification,
} from "@/domains/agent/lib/completion-notifications";
import {
	isTerminalConversationStatus,
	rootConversation,
} from "@/domains/agent/stores/conversation";
import { selectAgentIsRunning, useAgentStore } from "@/domains/agent/stores";
import type { AgentConversationState } from "@/domains/agent/stores/types";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useToast } from "@/hooks/useToast";

interface AgentCompletionNotificationSyncProps {
	isAgentSurfaceActive: boolean;
	projectId?: string | null;
}

export const AgentCompletionNotificationSync: React.FC<AgentCompletionNotificationSyncProps> = ({
	isAgentSurfaceActive,
	projectId,
}) => {
	const navigate = useNavigate();
	const toast = useToast();
	const isRunning = useAgentStore(selectAgentIsRunning);
	const [windowActive, setWindowActive] = useState(isWindowActive);
	const previousRunningRef = useRef(isRunning);

	useEffect(() => {
		const syncWindowActive = () => setWindowActive(isWindowActive());
		window.addEventListener("focus", syncWindowActive);
		window.addEventListener("blur", syncWindowActive);
		document.addEventListener("visibilitychange", syncWindowActive);
		return () => {
			window.removeEventListener("focus", syncWindowActive);
			window.removeEventListener("blur", syncWindowActive);
			document.removeEventListener("visibilitychange", syncWindowActive);
		};
	}, []);

	useEffect(() => {
		const wasRunning = previousRunningRef.current;
		previousRunningRef.current = isRunning;
		// Only react to the running -> not-running edge; a fresh run or an
		// unrelated re-render must not notify.
		if (!wasRunning || isRunning) return;

		const state = useAgentStore.getState();
		const outcome = resolveAgentRunOutcome(state.conversations, state.rootRunId);
		// A session reset (e.g. switching project) also drops isRunning to false,
		// but leaves no terminal conversation, so outcome is null and we skip it.
		if (!outcome) return;

		// Keep quiet while the user is actively watching the agent finish.
		if (windowActive && isAgentSurfaceActive) return;

		void showAgentCompletionSystemNotification(outcome, undefined, () => {
			window.focus();
			useAgentLayoutStore.getState().setTab("agent");
			if (projectId) {
				navigate(agentProjectPath(projectId), {
					state: agentProjectRouteState("agent"),
				});
			}
		}).then((result) => {
			if (result === "shown") return;
			if (outcome === "failed") {
				toast.error("Agent 运行失败", { description: "智能体本次运行失败，请查看详情。" });
			} else {
				toast.info("Agent 调用完成", { description: "智能体已完成本次运行。" });
			}
		});
	}, [isAgentSurfaceActive, isRunning, navigate, projectId, toast, windowActive]);

	return null;
};

const resolveAgentRunOutcome = (
	conversations: Record<string, AgentConversationState>,
	rootRunId: string | null,
): AgentCompletionOutcome | null => {
	const values = Object.values(conversations);
	if (values.length === 0) return null;
	// Guard against transient non-terminal states (e.g. a permission pause).
	if (values.some((conversation) => !isTerminalConversationStatus(conversation.status))) {
		return null;
	}

	const root = rootConversation(conversations, rootRunId);
	if (root?.status === "failed") return "failed";
	if (root?.status === "completed") return "completed";
	// Fall back to any terminal outcome when the root run cannot be resolved;
	// user-cancelled / interrupted / paused runs stay silent.
	if (values.some((conversation) => conversation.status === "failed")) return "failed";
	if (values.some((conversation) => conversation.status === "completed")) return "completed";
	return null;
};

const isWindowActive = () =>
	typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
