import type { StateCreator } from "zustand";
import type { AgentState } from "./types";

type AgentStateKey =
	| "isCollapsed"
	| "isConnected"
	| "isRunning"
	| "isChatHydrating"
	| "sessionId"
	| "lastEventId"
	| "rootRunId"
	| "conversations"
	| "streamingMessageId"
	| "activity"
	| "permissionRequests"
	| "runtimeAlerts"
	| "composerSeed"
	| "runtimeMode"
	| "lastRuntimeStatus";

export type AgentActions = Omit<AgentState, AgentStateKey>;
export type AgentSet = Parameters<StateCreator<AgentState>>[0];
export type AgentGet = Parameters<StateCreator<AgentState>>[1];

export interface AgentActionContext {
	set: AgentSet;
	get: AgentGet;
}
