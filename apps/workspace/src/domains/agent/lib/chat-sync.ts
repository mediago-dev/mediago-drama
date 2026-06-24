import { mutate as mutateSWR } from "swr";
import { agentChatKey, agentSessionsKey, getAgentChatState } from "@/domains/agent/api/agent";
import { selectAgentMessages, useAgentStore, type AgentMessage } from "@/domains/agent/stores";
import { useProjectStore } from "@/domains/projects/stores";

export const refreshAgentChatTranscript = async (
	sessionId?: string | null,
	projectId?: string | null,
) => {
	const hasExplicitProjectId = projectId !== undefined && projectId !== null;
	const targetProjectId = projectId ?? useProjectStore.getState().activeProjectId;
	const trimmedSessionId = sessionId?.trim() || null;
	if (
		!hasExplicitProjectId &&
		targetProjectId &&
		useProjectStore.getState().activeProjectId !== targetProjectId
	) {
		return;
	}

	const localMessages = selectAgentMessages(useAgentStore.getState());
	const state = await getAgentChatState(targetProjectId, trimmedSessionId);
	if (targetProjectId && state.projectId && state.projectId !== targetProjectId) return;
	if (
		!hasExplicitProjectId &&
		targetProjectId &&
		useProjectStore.getState().activeProjectId !== targetProjectId
	) {
		return;
	}

	const resolvedSessionId = state.sessionId?.trim() || trimmedSessionId;
	const currentSessionId = useAgentStore.getState().sessionId?.trim() || null;
	if (currentSessionId && resolvedSessionId && currentSessionId !== resolvedSessionId) return;

	const dropsLocalContext = transcriptDropsLocalContext(localMessages, state.messages);
	if (!dropsLocalContext) {
		useAgentStore.getState().hydrateAgentChatState(state.messages, state.activity, {
			sessionId: resolvedSessionId,
			rootRunId: state.rootRunId,
			conversations: state.conversations,
			lastEventId: state.lastEventId,
			running: state.running,
			pendingPermissions: state.pendingPermissions,
		});

		await mutateSWR(agentChatKey(targetProjectId, resolvedSessionId), state, {
			revalidate: false,
		});
	}
	if (targetProjectId) {
		await mutateSWR(agentSessionsKey(targetProjectId));
	}
};

// A backend transcript "drops local context" when it lacks messages the local store
// already has — either earlier context turns or the latest in-flight user turn. Callers
// use this to avoid overwriting an optimistic transcript with a stale snapshot.
export const transcriptDropsLocalContext = (
	localMessages: AgentMessage[],
	transcriptMessages: AgentMessage[],
) =>
	transcriptDropsEarlierLocalContext(localMessages, transcriptMessages) ||
	transcriptDropsLatestLocalTurn(localMessages, transcriptMessages);

const transcriptDropsEarlierLocalContext = (
	localMessages: AgentMessage[],
	transcriptMessages: AgentMessage[],
) => {
	const localLatestUserIndex = latestUserIndex(localMessages);
	if (localLatestUserIndex <= 0) return false;

	const localContext = localMessages.slice(0, localLatestUserIndex).filter(isContextMessage);
	if (localContext.length === 0) return false;
	return !isMessageSubsequence(localContext, transcriptMessages.filter(isContextMessage));
};

const transcriptDropsLatestLocalTurn = (
	localMessages: AgentMessage[],
	transcriptMessages: AgentMessage[],
) => {
	const localLatestUserIndex = latestUserIndex(localMessages);
	if (localLatestUserIndex < 0) return false;

	const latestUserContent = localMessages[localLatestUserIndex]?.content.trim();
	if (!latestUserContent) return false;
	const transcriptLatestUserIndex = latestMatchingUserIndex(transcriptMessages, latestUserContent);
	if (transcriptLatestUserIndex < 0) return true;

	const localAssistantAfterUser = hasAssistantMessageAfter(localMessages, localLatestUserIndex);
	if (!localAssistantAfterUser) return false;
	return !hasAssistantMessageAfter(transcriptMessages, transcriptLatestUserIndex);
};

const latestUserIndex = (messages: AgentMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") return index;
	}
	return -1;
};

const latestMatchingUserIndex = (messages: AgentMessage[], content: string) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user" && message.content.trim() === content) return index;
	}
	return -1;
};

const hasAssistantMessageAfter = (messages: AgentMessage[], userIndex: number) =>
	messages
		.slice(userIndex + 1)
		.some(
			(message) =>
				message.role === "assistant" &&
				(message.kind ?? "message") === "message" &&
				message.content.trim() !== "",
		);

const isContextMessage = (message: AgentMessage) => {
	const content = message.content.trim();
	if (!content) return false;
	if (message.role === "user") return true;
	return (message.kind ?? "message") !== "runtime";
};

const isMessageSubsequence = (expected: AgentMessage[], actual: AgentMessage[]) => {
	let actualIndex = 0;
	for (const message of expected) {
		const fingerprint = messageFingerprint(message);
		let found = false;
		while (actualIndex < actual.length) {
			const actualMessage = actual[actualIndex];
			if (actualMessage && messageFingerprint(actualMessage) === fingerprint) {
				found = true;
				actualIndex += 1;
				break;
			}
			actualIndex += 1;
		}
		if (!found) return false;
	}
	return true;
};

const messageFingerprint = (message: AgentMessage) =>
	[message.role, message.kind ?? "message", message.content.trim()].join("\u0000");
