import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { KeyedMutator } from "swr";
import { mutate as mutateSWR } from "swr";
import type { MediaAssetsResponse } from "@/domains/workspace/api/media";
import {
	deleteGenerationTaskAsset,
	deleteGenerationTask,
	type GenerationKind,
	type GenerationTask,
	type GenerationTasksResponse,
	generationConversationsQueryKey,
	getGenerationVideo,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import {
	generatedAssetsIncludeMediaAssets,
	isPendingGenerationMessage,
	isPendingVideoMessage,
	messageFromResponse,
	removeGenerationEntryMessages,
	taskIdFromGenerationEntryId,
	type ChatMessage,
} from "./useGenerationWorkspace.helpers";

interface UseGenerationTaskActionsOptions {
	conversationId?: string | null;
	conversationMessages: ChatMessage[];
	initialKind?: GenerationKind;
	kind: GenerationKind;
	mutateMediaAssets: KeyedMutator<MediaAssetsResponse>;
	mutateProjectGenerationTasks: (kind: GenerationKind) => void;
	mutateTasks: KeyedMutator<GenerationTasksResponse>;
	projectId?: string | null;
	resolvedConversationScopeId?: string;
	setActiveEntryId: (next: React.SetStateAction<string | null>) => void;
	setError: (message: string | null) => void;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const pendingGenerationFallbackRefreshMs = 30_000;

export const useGenerationTaskActions = ({
	conversationId,
	conversationMessages,
	initialKind,
	kind,
	mutateMediaAssets,
	mutateProjectGenerationTasks,
	mutateTasks,
	projectId,
	resolvedConversationScopeId,
	setActiveEntryId,
	setError,
	setMessages,
}: UseGenerationTaskActionsOptions) => {
	const [deletedAssetPlaceholderCounts, setDeletedAssetPlaceholderCounts] = useState<
		Record<string, number>
	>({});
	const [deletingAssetKeys, setDeletingAssetKeys] = useState<string[]>([]);
	const [deletingEntryIds, setDeletingEntryIds] = useState<string[]>([]);

	const refreshVideoByID = useCallback(
		async (id: string) => {
			if (!id) return null;

			setError(null);
			const response = await getGenerationVideo(id);
			void mutateTasks();
			mutateProjectGenerationTasks("video");
			if (generatedAssetsIncludeMediaAssets(response.assets)) {
				void mutateMediaAssets();
			}

			return response;
		},
		[mutateMediaAssets, mutateProjectGenerationTasks, mutateTasks, setError],
	);

	const refreshVideo = useCallback(
		async (message: ChatMessage) => {
			if (!message.id || message.kind !== "video") return;

			try {
				const response = await refreshVideoByID(message.id);
				if (!response) return;
				setMessages((current) =>
					current.map((currentMessage) =>
						currentMessage.id === message.id
							? messageFromResponse(response, "video")
							: currentMessage,
					),
				);
			} catch (err) {
				const nextError = errorMessage(err, "视频状态检查失败。");
				setError(nextError);
				setMessages((current) =>
					current.map((currentMessage) =>
						currentMessage.id === message.id
							? failedVideoMessage(currentMessage, nextError)
							: currentMessage,
					),
				);
				void mutateTasks();
				mutateProjectGenerationTasks("video");
			}
		},
		[mutateProjectGenerationTasks, mutateTasks, refreshVideoByID, setError, setMessages],
	);

	const deleteGenerationEntry = useCallback(
		async (entryId: string) => {
			if (!entryId) return false;

			const taskId = taskIdFromGenerationEntryId(entryId);
			setError(null);
			setDeletingEntryIds((current) =>
				current.includes(entryId) ? current : [...current, entryId],
			);
			setMessages((current) => removeGenerationEntryMessages(current, entryId));
			setActiveEntryId((current) => (current === entryId ? null : current));
			setDeletedAssetPlaceholderCounts((current) => {
				const { [entryId]: _removed, ...rest } = current;
				return rest;
			});

			try {
				if (taskId) {
					const nextTasks = await deleteGenerationTask(taskId);
					if (conversationId || initialKind) {
						await mutateTasks();
					} else {
						await mutateTasks(nextTasks, false);
					}
				} else {
					// Local/optimistic entry: revalidate, then delete any orphan backend task the
					// submit created so the record does not come back on the next refresh.
					const latest = await mutateTasks();
					const orphanTaskId = orphanTaskIdForLocalEntry(
						latest?.tasks ?? [],
						entryId,
						conversationMessages,
						kind,
					);
					if (orphanTaskId) {
						await deleteGenerationTask(orphanTaskId);
						await mutateTasks();
					}
				}
				mutateProjectGenerationTasks(kind);
				void mutateSWR(generationConversationsQueryKey(kind, resolvedConversationScopeId));
				void mutateSWR(generationConversationsQueryKey(kind, "", { allScopes: true }));
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : "生成记录删除失败。";
				setError(message);
				void mutateTasks();
				return false;
			} finally {
				setDeletingEntryIds((current) => current.filter((id) => id !== entryId));
			}
		},
		[
			conversationId,
			conversationMessages,
			initialKind,
			kind,
			mutateProjectGenerationTasks,
			mutateTasks,
			resolvedConversationScopeId,
			setActiveEntryId,
			setError,
			setMessages,
		],
	);

	const deleteGenerationEntryAsset = useCallback(
		async (entryId: string, assetIndex: number) => {
			if (!entryId || assetIndex < 0) return false;

			const taskId = taskIdForDeletion(entryId);
			if (!taskId) return false;

			const deletingKey = `${entryId}:${assetIndex}`;
			setError(null);
			setDeletingAssetKeys((current) =>
				current.includes(deletingKey) ? current : [...current, deletingKey],
			);
			setMessages((current) =>
				current.map((message) => {
					if (message.id !== entryId) return message;

					return {
						...message,
						assets: (message.assets ?? []).filter(
							(asset, index) => generationAssetSlotIndex(asset, index) !== assetIndex,
						),
					};
				}),
			);

			try {
				await deleteGenerationTaskAsset(taskId, assetIndex);
				await mutateTasks();
				mutateProjectGenerationTasks(kind);
				const normalizedProjectId = projectId?.trim();
				if (normalizedProjectId) {
					void mutateSWR(selectedGenerationAssetsQueryKey(normalizedProjectId));
				}
				void mutateSWR(generationConversationsQueryKey(kind, resolvedConversationScopeId));
				void mutateSWR(generationConversationsQueryKey(kind, "", { allScopes: true }));
				return true;
			} catch (err) {
				void mutateTasks();
				throw new Error(errorMessage(err, "生成图片删除失败。"));
			} finally {
				setDeletingAssetKeys((current) => current.filter((key) => key !== deletingKey));
			}
		},
		[
			kind,
			mutateProjectGenerationTasks,
			mutateTasks,
			projectId,
			resolvedConversationScopeId,
			setError,
			setMessages,
		],
	);

	const deleteGenerationEntryAssetPlaceholder = useCallback(
		async (entryId: string, assetIndex: number) => {
			if (!entryId || assetIndex < 0) return false;

			const taskId = taskIdForDeletion(entryId);
			if (!taskId) return false;

			const deletingKey = `${entryId}:${assetIndex}`;
			setError(null);
			setDeletingAssetKeys((current) =>
				current.includes(deletingKey) ? current : [...current, deletingKey],
			);

			try {
				await deleteGenerationTaskAsset(taskId, assetIndex);
				await mutateTasks();
				mutateProjectGenerationTasks(kind);
				void mutateSWR(generationConversationsQueryKey(kind, resolvedConversationScopeId));
				void mutateSWR(generationConversationsQueryKey(kind, "", { allScopes: true }));
				return true;
			} catch (err) {
				void mutateTasks();
				throw new Error(errorMessage(err, "生成图片删除失败。"));
			} finally {
				setDeletingAssetKeys((current) => current.filter((key) => key !== deletingKey));
			}
		},
		[kind, mutateProjectGenerationTasks, mutateTasks, resolvedConversationScopeId, setError],
	);

	useEffect(() => {
		const pendingMessages = conversationMessages.filter(isPendingVideoMessage);
		if (pendingMessages.length === 0) return;

		const timer = window.setTimeout(() => {
			for (const message of pendingMessages) {
				void refreshVideo(message);
			}
		}, pendingGenerationFallbackRefreshMs);

		return () => window.clearTimeout(timer);
	}, [conversationMessages, refreshVideo]);

	useEffect(() => {
		if (!conversationMessages.some(isPendingGenerationMessage)) return;

		const timer = window.setInterval(() => {
			void mutateTasks();
		}, pendingGenerationFallbackRefreshMs);

		return () => window.clearInterval(timer);
	}, [conversationMessages, mutateTasks]);

	return {
		deletedAssetPlaceholderCounts,
		deleteGenerationEntryAsset,
		deleteGenerationEntryAssetPlaceholder,
		deleteGenerationEntry,
		deletingAssetKeys,
		deletingEntryIds,
		refreshVideo,
	};
};

const taskIdForDeletion = (entryId: string) => {
	const taskId = taskIdFromGenerationEntryId(entryId);
	if (taskId) return taskId;

	const baseId = entryId.replace(/:(assistant|error|prompt)$/, "");
	return baseId && !baseId.startsWith("local-") && !baseId.startsWith("media-library:")
		? baseId
		: null;
};

// A client-local (optimistic or client-side-errored) entry has no task id, yet the submit may
// have created a backend task (e.g. the request timed out client-side while the server kept
// going). Find that orphan task so deleting the local entry also removes it and it does not
// reappear on the next refresh. Matching is intentionally strict — same kind, exact prompt, and
// no existing entry already renders it — so a real, visible task is never deleted by mistake.
export const orphanTaskIdForLocalEntry = (
	tasks: GenerationTask[],
	entryId: string,
	messages: ChatMessage[],
	kind: GenerationKind,
): string | null => {
	const localBase = /^(local-[^:]+)(?::(?:assistant|prompt|error))?$/.exec(entryId)?.[1];
	if (!localBase) return null;

	const prompt = messages
		.find((message) => message.role === "user" && message.id === `${localBase}:prompt`)
		?.content?.trim();
	if (!prompt) return null;

	const shownTaskIds = new Set(
		messages.filter((message) => message.role === "assistant").map((message) => message.id),
	);
	const matches = tasks.filter(
		(task) =>
			task.kind === kind && (task.prompt ?? "").trim() === prompt && !shownTaskIds.has(task.id),
	);
	return matches.length === 1 ? matches[0].id : null;
};

const generationAssetSlotIndex = (asset: { slotIndex?: number }, fallback: number) => {
	const slotIndex = asset.slotIndex;
	return typeof slotIndex === "number" && Number.isInteger(slotIndex) && slotIndex >= 0
		? slotIndex
		: fallback;
};

const failedVideoMessage = (message: ChatMessage, error: string): ChatMessage => ({
	...message,
	status: "error",
	content: videoRefreshFailureContent(message.content),
	error: error.trim(),
	errorCode: "status_check_failed",
	errorType: "provider_error",
	retryable: true,
	updatedAt: new Date().toISOString(),
});

const videoRefreshFailureContent = (content: string) => {
	const trimmedContent = content.trim();
	return trimmedContent && !isSubmittedVideoPlaceholder(trimmedContent)
		? trimmedContent
		: "视频状态检查失败。";
};

const isSubmittedVideoPlaceholder = (content: string) =>
	content.includes("已提交") && content.includes("检查状态");

const errorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}

	return fallback;
};
