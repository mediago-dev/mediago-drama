import { mutate as mutateSWR } from "swr";
import { agentChatKey, agentSessionsKey, getAgentChatState } from "@/domains/agent/api/agent";
import { selectAgentMessages, useAgentStore, type AgentMessage } from "@/domains/agent/stores";
import { useProjectStore } from "@/domains/projects/stores";

export const refreshAgentChatTranscript = async (
	sessionId?: string | null,
	projectId?: string | null,
) => {
	const targetProjectId = projectId ?? useProjectStore.getState().activeProjectId;
	const trimmedSessionId = sessionId?.trim() || null;
	if (targetProjectId && useProjectStore.getState().activeProjectId !== targetProjectId) return;

	const localMessages = selectAgentMessages(useAgentStore.getState());
	const state = await getAgentChatState(targetProjectId, trimmedSessionId);
	if (targetProjectId && useProjectStore.getState().activeProjectId !== targetProjectId) return;

	const resolvedSessionId = state.sessionId?.trim() || trimmedSessionId;
	const currentSessionId = useAgentStore.getState().sessionId?.trim() || null;
	if (currentSessionId && resolvedSessionId && currentSessionId !== resolvedSessionId) return;

	const dropsLatestAssistantTurn = transcriptDropsLatestAssistantTurn(
		localMessages,
		state.messages,
	);
	if (!dropsLatestAssistantTurn) {
		useAgentStore.getState().hydrateAgentChatState(state.messages, state.activity, {
			sessionId: resolvedSessionId,
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

const transcriptDropsLatestAssistantTurn = (
	localMessages: AgentMessage[],
	transcriptMessages: AgentMessage[],
) => {
	const localLatestUserIndex = latestUserIndex(localMessages);
	if (localLatestUserIndex < 0) return false;
	const localAssistantAfterUser = hasAssistantMessageAfter(localMessages, localLatestUserIndex);
	if (!localAssistantAfterUser) return false;

	const latestUserContent = localMessages[localLatestUserIndex]?.content.trim();
	if (!latestUserContent) return false;
	const transcriptLatestUserIndex = latestMatchingUserIndex(transcriptMessages, latestUserContent);
	if (transcriptLatestUserIndex < 0) return false;
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
