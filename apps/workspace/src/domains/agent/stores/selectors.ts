import { rootConversation } from "./conversation";
import type { AgentMessage, AgentState } from "./types";

const emptyAgentMessages: AgentMessage[] = [];

export const selectAgentActivity = (state: AgentState) => state.activity;

export const selectAgentComposerSeed = (state: AgentState) => state.composerSeed;

export const selectAgentConversations = (state: AgentState) => state.conversations;

export const selectAgentExpand = (state: AgentState) => state.expand;

export const selectAgentIsConnected = (state: AgentState) => state.isConnected;

export const selectAgentIsRunning = (state: AgentState) => state.isRunning;

export const selectAgentLastRuntimeStatus = (state: AgentState) => state.lastRuntimeStatus;

export const selectAgentLatestActivity = (state: AgentState) => state.activity[0];

export const selectAgentMessages = (state: AgentState) =>
	rootConversation(state.conversations, state.rootRunId)?.messages ?? emptyAgentMessages;

export const selectAgentPermissionRequests = (state: AgentState) => state.permissionRequests;

export const selectAgentRecordActivity = (state: AgentState) => state.recordActivity;

export const selectAgentRecordPatchApplied = (state: AgentState) => state.recordPatchApplied;

export const selectAgentRecordPatchRejected = (state: AgentState) => state.recordPatchRejected;

export const selectAgentRemovePermissionRequest = (state: AgentState) =>
	state.removePermissionRequest;

export const selectAgentRootRunId = (state: AgentState) => state.rootRunId;

export const selectAgentRuntimeAlerts = (state: AgentState) => state.runtimeAlerts;

export const selectAgentSessionId = (state: AgentState) => state.sessionId;

export const selectAgentStreamingMessageId = (state: AgentState) => state.streamingMessageId;

export const selectConsumeAgentComposerSeed = (state: AgentState) => state.consumeComposerSeed;
