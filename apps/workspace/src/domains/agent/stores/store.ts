import { createStore } from "@/shared/lib/utils";
import { createAgentActions } from "./actions";
import type { AgentState } from "./types";

export const useAgentStore = createStore<AgentState>(
	(set) => ({
		isCollapsed: true,
		isConnected: false,
		isRunning: false,
		sessionId: null,
		lastEventId: null,
		rootRunId: null,
		conversations: {},
		streamingMessageId: null,
		activity: [],
		permissionRequests: [],
		runtimeAlerts: [],
		composerSeed: null,
		runtimeMode: "remote",
		lastRuntimeStatus: {
			runtime: "unknown",
			fallback: false,
			validated: false,
		},
		...createAgentActions({ set }),
	}),
	"agentStore",
);
