import { mutate as mutateSWR } from "swr";
import { agentChatKey, agentSessionsKey, getAgentChatState } from "@/domains/agent/api/agent";
import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";
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

	const state = await getAgentChatState(targetProjectId, trimmedSessionId);
	if (targetProjectId && state.projectId && state.projectId !== targetProjectId) return;
	if (
		!hasExplicitProjectId &&
		targetProjectId &&
		useProjectStore.getState().activeProjectId !== targetProjectId
	) {
		return;
	}

	const store = useAgentStore.getState();
	const resolvedSessionId = state.sessionId?.trim() || trimmedSessionId;
	const currentSessionId = store.sessionId?.trim() || null;
	if (currentSessionId && resolvedSessionId && currentSessionId !== resolvedSessionId) return;

	const preserveLocal = shouldPreserveLocalTranscript({
		isRunning: store.isRunning,
		appliedLastEventId: store.lastEventId,
		localMessageCount: selectAgentMessages(store).length,
		snapshotLastEventId: state.lastEventId,
		snapshotIsEmpty: isEmptyTranscriptSnapshot(state),
	});
	if (!preserveLocal) {
		store.hydrateAgentChatState(state.messages, state.activity, {
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

export interface LocalTranscriptReconcileInput {
	/** Whether a run is currently streaming into the local store. */
	isRunning: boolean;
	/** Highest server sequence the local store has already applied. */
	appliedLastEventId: string | null;
	/** How many messages the local store currently renders. */
	localMessageCount: number;
	/** Server sequence the fetched snapshot is current as of. */
	snapshotLastEventId: string | null | undefined;
	/** Whether the snapshot carries no messages or conversations. */
	snapshotIsEmpty: boolean;
}

// Decides whether a fetched chat snapshot should be discarded in favor of the
// live local transcript. This replaces content-fingerprint heuristics with a
// single sequence comparison: the store's `lastEventId` is the authoritative
// "applied up to" cursor, and the snapshot's `lastEventId` is what it reflects.
export const shouldPreserveLocalTranscript = (input: LocalTranscriptReconcileInput): boolean => {
	// Nothing local to protect — always take the snapshot.
	if (input.localMessageCount === 0) return false;
	// When no run is streaming, the fetched snapshot is the authoritative full
	// history and must win. A restored cache (or a stale cursor) must never
	// suppress it — doing so blanks the panel even though the backend has data.
	if (!input.isRunning) return false;

	const snapshotSequence = sequenceNumber(input.snapshotLastEventId);
	const appliedSequence = sequenceNumber(input.appliedLastEventId);

	// During a run, protect locally-applied live events and a just-sent optimistic
	// turn the backend has not projected yet, and never replace them with an empty
	// snapshot.
	return snapshotSequence <= appliedSequence || input.snapshotIsEmpty;
};

const isEmptyTranscriptSnapshot = (snapshot: {
	messages: readonly unknown[];
	conversations?: Record<string, unknown> | null;
}) => snapshot.messages.length === 0 && Object.keys(snapshot.conversations ?? {}).length === 0;

const sequenceNumber = (value: string | null | undefined) => {
	const parsed = Number(String(value ?? "").trim());
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};
