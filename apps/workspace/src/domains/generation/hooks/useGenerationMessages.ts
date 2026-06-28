import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { GenerationModelsResponse, GenerationTask } from "@/domains/generation/api/generation";
import {
	entriesFromMessages,
	mergeConversationMessages,
	messagesFromTasks,
	readScopedGenerationMessages,
	rehydrateScopedGenerationMessages,
	removeMessagesBackedByTasks,
	removeStaleLocalPendingMessages,
	sameChatMessageList,
	scopedGenerationHistoryPersistStorageKey,
	scopedGenerationHistoryStorageKey,
	syncScopedMessagesWithTasks,
	useScopedGenerationHistoryStore,
	writeScopedGenerationMessages,
	type ChatMessage,
} from "./useGenerationWorkspace.helpers";

interface UseGenerationMessagesOptions {
	activeEntryId?: string | null;
	catalog: GenerationModelsResponse;
	historyScopeId?: string;
	mediaAssets: MediaAsset[];
	onActiveEntryIdChange?: (entryId: string | null) => void;
	recentTasks: GenerationTask[];
}

interface ScopedMessagesState {
	messages: ChatMessage[];
	scopeId: string;
}

export const useGenerationMessages = ({
	activeEntryId: controlledActiveEntryId,
	catalog,
	historyScopeId,
	mediaAssets,
	onActiveEntryIdChange,
	recentTasks,
}: UseGenerationMessagesOptions) => {
	const currentScopeId = historyScopeId ?? "";
	const [scopedMessages, setScopedMessages] = useState<ScopedMessagesState>(() => ({
		scopeId: currentScopeId,
		messages: historyScopeId ? readScopedGenerationMessages(historyScopeId) : [],
	}));
	const [uncontrolledActiveEntryId, setUncontrolledActiveEntryId] = useState<string | null>(null);
	const messages = scopedMessages.scopeId === currentScopeId ? scopedMessages.messages : [];
	const setMessages = useCallback<React.Dispatch<React.SetStateAction<ChatMessage[]>>>(
		(next) => {
			setScopedMessages((current) => {
				const currentMessages = current.scopeId === currentScopeId ? current.messages : [];
				const nextMessages =
					typeof next === "function"
						? (next as (current: ChatMessage[]) => ChatMessage[])(currentMessages)
						: next;
				if (
					current.scopeId === currentScopeId &&
					sameChatMessageList(current.messages, nextMessages)
				) {
					return current;
				}
				return { scopeId: currentScopeId, messages: nextMessages };
			});
		},
		[currentScopeId],
	);
	const activeEntryId =
		controlledActiveEntryId === undefined ? uncontrolledActiveEntryId : controlledActiveEntryId;
	const setActiveEntryId = useCallback(
		(next: React.SetStateAction<string | null>) => {
			const resolved =
				typeof next === "function"
					? (next as (current: string | null) => string | null)(activeEntryId)
					: next;
			if (controlledActiveEntryId === undefined) {
				setUncontrolledActiveEntryId(resolved);
			}
			onActiveEntryIdChange?.(resolved);
		},
		[activeEntryId, controlledActiveEntryId, onActiveEntryIdChange],
	);
	const historyMessages = useMemo(
		() => messagesFromTasks(recentTasks, mediaAssets, catalog),
		[catalog, mediaAssets, recentTasks],
	);
	const conversationMessages = useMemo(
		() => mergeConversationMessages(historyMessages, messages),
		[historyMessages, messages],
	);

	useEffect(() => {
		const nextMessages = historyScopeId ? readScopedGenerationMessages(historyScopeId) : [];
		setScopedMessages((current) =>
			current.scopeId === currentScopeId && sameChatMessageList(current.messages, nextMessages)
				? current
				: { scopeId: currentScopeId, messages: nextMessages },
		);
	}, [currentScopeId, historyScopeId]);

	useEffect(() => {
		if (!historyScopeId) return;

		const syncMessages = () => {
			const nextMessages = readScopedGenerationMessages(historyScopeId);
			setMessages((current) =>
				sameChatMessageList(current, nextMessages) ? current : nextMessages,
			);
		};
		const unsubscribe = useScopedGenerationHistoryStore.subscribe(syncMessages);
		const syncFromStorage = (event: StorageEvent) => {
			if (
				event.key !== scopedGenerationHistoryPersistStorageKey &&
				event.key !== scopedGenerationHistoryStorageKey
			) {
				return;
			}
			void Promise.resolve(rehydrateScopedGenerationMessages()).then(syncMessages);
		};

		window.addEventListener("storage", syncFromStorage);
		return () => {
			unsubscribe();
			window.removeEventListener("storage", syncFromStorage);
		};
	}, [historyScopeId, setMessages]);

	useEffect(() => {
		if (!historyScopeId) return;
		if (scopedMessages.scopeId !== currentScopeId) return;
		writeScopedGenerationMessages(historyScopeId, scopedMessages.messages);
	}, [currentScopeId, historyScopeId, scopedMessages]);

	useEffect(() => {
		if (!historyScopeId || recentTasks.length === 0) return;

		setMessages((current) => {
			const syncedMessages = syncScopedMessagesWithTasks(
				current,
				recentTasks,
				mediaAssets,
				catalog,
			);
			const optimisticMessages = removeStaleLocalPendingMessages(
				removeMessagesBackedByTasks(syncedMessages, recentTasks),
				recentTasks,
			);
			return sameChatMessageList(current, optimisticMessages) ? current : optimisticMessages;
		});
	}, [catalog, historyScopeId, mediaAssets, recentTasks]);

	const generationEntries = useMemo(
		() => entriesFromMessages(conversationMessages),
		[conversationMessages],
	);
	const orderedGenerationEntries = useMemo(
		() => [...generationEntries].reverse(),
		[generationEntries],
	);
	const activeEntry =
		generationEntries.find((entry) => entry.id === activeEntryId) ??
		generationEntries[generationEntries.length - 1] ??
		null;

	return {
		activeEntry,
		activeEntryId,
		conversationMessages,
		generationEntries,
		messages,
		orderedGenerationEntries,
		setActiveEntryId,
		setMessages,
	};
};
