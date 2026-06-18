import type {
	GenerationAsset,
	GenerationKind,
	GenerationMessageResponse,
	GenerationModelsResponse,
	GenerationTask,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { assistantTaskDetails, userTaskDetails } from "./generationFormatters";
import type { ChatMessage, GenerationEntry } from "./generationTypes";

const pendingGenerationStatuses = new Set([
	"loading",
	"streaming",
	"submitting",
	"submitted",
	"running",
	"pending",
	"processing",
	"queued",
]);

const sortableTimeOf = (item: { createdAt?: string; updatedAt?: string }) => {
	const time = Date.parse(item.createdAt || item.updatedAt || "");

	return Number.isNaN(time) ? 0 : time;
};

export const isPendingGenerationMessage = (message: ChatMessage) =>
	message.role === "assistant" &&
	pendingGenerationStatuses.has(String(message.status ?? "").toLowerCase());

export const isPendingVideoMessage = (message: ChatMessage) =>
	isPendingGenerationMessage(message) && message.kind === "video";

export const messageFromResponse = (
	response: GenerationMessageResponse,
	kind: GenerationKind,
): ChatMessage => ({
	id: response.id,
	role: "assistant",
	kind,
	status: generationStatusWithError(response.status, response.error),
	content: kind === "text" && response.text ? response.text : response.message,
	assets: response.assets,
	error: response.error,
	errorCode: response.errorCode,
	errorType: response.errorType,
	retryable: response.retryable,
});

const messageFromTask = (task: GenerationTask): ChatMessage => ({
	id: task.id,
	role: "assistant",
	kind: task.kind,
	status: generationStatusWithError(task.status, task.error),
	content: task.kind === "text" && task.text ? task.text : task.message,
	assets: task.assets,
	createdAt: task.createdAt,
	deletedAssetSlots: task.deletedAssetSlots,
	details: assistantTaskDetails(task),
	durationMs: task.durationMs,
	error: task.error,
	errorCode: task.errorCode,
	errorType: task.errorType,
	retryable: task.retryable,
	updatedAt: task.updatedAt,
});

const generationStatusWithError = (status: string, error?: string) => {
	if (error?.trim() && pendingGenerationStatuses.has(status.toLowerCase())) {
		return "error";
	}

	return status;
};

export const entriesFromMessages = (messages: ChatMessage[]): GenerationEntry[] => {
	const entries: GenerationEntry[] = [];
	let pendingRequest: ChatMessage | null = null;

	for (const message of messages) {
		if (message.role === "user") {
			pendingRequest = message;
			continue;
		}

		entries.push({
			id: message.id,
			kind: message.kind,
			status: message.status,
			content: message.content,
			assets: message.assets,
			createdAt: message.createdAt ?? pendingRequest?.createdAt,
			deletedAssetSlots: message.deletedAssetSlots,
			durationMs: message.durationMs,
			error: message.error,
			errorCode: message.errorCode,
			errorType: message.errorType,
			retryable: message.retryable,
			resultDetails: message.details,
			assistantMessage: message,
			prompt: pendingRequest?.content ?? "",
			requestAssets: pendingRequest?.assets,
			requestDetails: pendingRequest?.details,
			updatedAt: message.updatedAt,
		});
		pendingRequest = null;
	}

	if (pendingRequest) {
		entries.push({
			id: taskIdFromUserMessageId(pendingRequest.id) ?? pendingRequest.id,
			kind: pendingRequest.kind,
			status: "submitted",
			content: "等待生成结果。",
			createdAt: pendingRequest.createdAt,
			prompt: pendingRequest.content,
			requestAssets: pendingRequest.assets,
			requestDetails: pendingRequest.details,
			updatedAt: pendingRequest.updatedAt,
		});
	}

	return entries;
};

const userMessageID = (taskID: string) => `${taskID}:prompt`;

export const messagesFromTasks = (
	tasks: GenerationTask[],
	mediaAssets: MediaAsset[],
	catalog: GenerationModelsResponse,
) => {
	const orderedTasks = [...tasks].sort((left, right) => {
		return sortableTimeOf(left) - sortableTimeOf(right);
	});

	return orderedTasks.flatMap<ChatMessage>((task) => [
		{
			id: userMessageID(task.id),
			role: "user",
			kind: task.kind,
			content: task.prompt,
			assets: referenceAssetsFromTask(task, mediaAssets),
			createdAt: task.createdAt,
			details: userTaskDetails(task, catalog),
			updatedAt: task.updatedAt,
		},
		messageFromTask(task),
	]);
};

export const mergeConversationMessages = (
	historyMessages: ChatMessage[],
	localMessages: ChatMessage[],
) => {
	const merged: ChatMessage[] = [];
	const indexes = new Map<string, number>();

	for (const message of [...localMessages, ...historyMessages]) {
		const existingIndex = indexes.get(message.id);
		if (existingIndex === undefined) {
			indexes.set(message.id, merged.length);
			merged.push(message);
		} else {
			const existing = merged[existingIndex];
			merged[existingIndex] = shouldKeepLocalGenerationMessage(existing, message)
				? existing
				: message;
		}
	}

	merged.sort(compareConversationMessages);

	return merged;
};

const compareConversationMessages = (left: ChatMessage, right: ChatMessage) => {
	const timeDifference = sortableTimeOf(left) - sortableTimeOf(right);
	if (timeDifference !== 0) return timeDifference;

	const leftTaskId = taskIdFromChatMessage(left);
	const rightTaskId = taskIdFromChatMessage(right);
	if (leftTaskId && leftTaskId === rightTaskId && left.role !== right.role) {
		return left.role === "user" ? -1 : 1;
	}

	return 0;
};

export const scopedGenerationHistoryStorageKey = "mediago_drama_section_generation_history";
export const scopedGenerationHistoryPersistStorageKey =
	"mediago_drama_section_generation_history.store.v1";
const scopedGenerationHistoryLimit = 40;

interface ScopedGenerationHistoryState {
	messagesByScope: Record<string, ChatMessage[]>;
	setScopeMessages: (scopeId: string, messages: ChatMessage[]) => void;
}

export const useScopedGenerationHistoryStore = create<ScopedGenerationHistoryState>()(
	persist(
		immer((set) => ({
			messagesByScope: readLegacyScopedGenerationMessages(),
			setScopeMessages: (scopeId, messages) =>
				set((state) => {
					state.messagesByScope[scopeId] = messages.slice(-scopedGenerationHistoryLimit);
				}),
		})),
		{
			name: scopedGenerationHistoryPersistStorageKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ messagesByScope: state.messagesByScope }),
			merge: (persisted, current) => {
				const messagesByScope =
					(persisted as Partial<Pick<ScopedGenerationHistoryState, "messagesByScope">>)
						?.messagesByScope ?? {};
				return {
					...current,
					messagesByScope: normalizeScopedGenerationMessages(messagesByScope),
				};
			},
		},
	),
);

export const readScopedGenerationMessages = (scopeId: string): ChatMessage[] => {
	const messages = useScopedGenerationHistoryStore.getState().messagesByScope[scopeId];
	return Array.isArray(messages) ? messages.slice(-scopedGenerationHistoryLimit) : [];
};

export const writeScopedGenerationMessages = (scopeId: string, messages: ChatMessage[]) => {
	try {
		useScopedGenerationHistoryStore.getState().setScopeMessages(scopeId, messages);
	} catch {
		// Local history is a convenience cache; generation itself should still work.
	}
};

export const rehydrateScopedGenerationMessages = () =>
	useScopedGenerationHistoryStore.persist.rehydrate();

function normalizeScopedGenerationMessages(value: unknown): Record<string, ChatMessage[]> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const messagesByScope: Record<string, ChatMessage[]> = {};
	for (const [scopeId, messages] of Object.entries(value)) {
		if (!scopeId || !Array.isArray(messages)) continue;
		messagesByScope[scopeId] = messages
			.filter((message): message is ChatMessage => isChatMessage(message))
			.slice(-scopedGenerationHistoryLimit);
	}

	return messagesByScope;
}

function isChatMessage(value: unknown): value is ChatMessage {
	if (!value || typeof value !== "object") return false;

	const message = value as Partial<ChatMessage>;
	return (
		typeof message.id === "string" &&
		(message.role === "user" || message.role === "assistant") &&
		(message.kind === "image" || message.kind === "video" || message.kind === "text") &&
		typeof message.content === "string"
	);
}

function readLegacyScopedGenerationMessages() {
	try {
		if (typeof window === "undefined") return {};

		const raw = localStorage.getItem(scopedGenerationHistoryStorageKey);
		return normalizeScopedGenerationMessages(raw ? JSON.parse(raw) : {});
	} catch {
		return {};
	}
}

export const syncScopedMessagesWithTasks = (
	messages: ChatMessage[],
	tasks: GenerationTask[],
	mediaAssets: MediaAsset[],
	catalog: GenerationModelsResponse,
) => {
	const taskById = new Map(tasks.map((task) => [task.id, task]));
	let changed = false;

	const nextMessages = messages.map((message) => {
		const taskId = message.role === "user" ? taskIdFromUserMessageId(message.id) : message.id;
		if (!taskId) return message;

		const task = taskById.get(taskId);
		if (!task) return message;
		if (shouldKeepLocalMessageOverTask(message, task)) return message;

		const nextMessage =
			message.role === "user"
				? userMessageFromTask(task, mediaAssets, catalog)
				: messageFromTask(task);
		if (sameChatMessage(message, nextMessage)) return message;

		changed = true;
		return nextMessage;
	});

	return changed ? nextMessages : messages;
};

const shouldKeepLocalGenerationMessage = (localMessage: ChatMessage, historyMessage: ChatMessage) =>
	localMessage.role === "assistant" &&
	historyMessage.role === "assistant" &&
	isTerminalLocalGenerationMessage(localMessage) &&
	isPendingGenerationMessage(historyMessage);

const shouldKeepLocalMessageOverTask = (message: ChatMessage, task: GenerationTask) =>
	message.role === "assistant" &&
	isTerminalLocalGenerationMessage(message) &&
	pendingGenerationStatuses.has(String(task.status ?? "").toLowerCase()) &&
	!task.error?.trim();

const isTerminalLocalGenerationMessage = (message: ChatMessage) =>
	!isPendingGenerationMessage(message) &&
	(Boolean(message.status) || Boolean(message.error?.trim()) || Boolean(message.assets?.length));

const userMessageFromTask = (
	task: GenerationTask,
	mediaAssets: MediaAsset[],
	catalog: GenerationModelsResponse,
): ChatMessage => ({
	id: userMessageID(task.id),
	role: "user",
	kind: task.kind,
	content: task.prompt,
	assets: referenceAssetsFromTask(task, mediaAssets),
	createdAt: task.createdAt,
	details: userTaskDetails(task, catalog),
	updatedAt: task.updatedAt,
});

const taskIdFromUserMessageId = (id: string) => {
	const suffix = ":prompt";
	return id.endsWith(suffix) ? id.slice(0, -suffix.length) : null;
};

const taskIdFromChatMessage = (message: ChatMessage) => {
	if (message.role === "user") return taskIdFromUserMessageId(message.id);
	if (message.role === "assistant") return message.id;
	return null;
};

const sameChatMessage = (left: ChatMessage, right: ChatMessage) =>
	left.id === right.id &&
	left.role === right.role &&
	left.kind === right.kind &&
	left.status === right.status &&
	left.content === right.content &&
	left.createdAt === right.createdAt &&
	left.durationMs === right.durationMs &&
	left.error === right.error &&
	left.errorCode === right.errorCode &&
	left.errorType === right.errorType &&
	left.retryable === right.retryable &&
	left.updatedAt === right.updatedAt &&
	JSON.stringify(left.assets ?? []) === JSON.stringify(right.assets ?? []) &&
	JSON.stringify(left.details ?? []) === JSON.stringify(right.details ?? []);

export const referenceAssetsFromInputs = (
	referenceUrls: string[],
	referenceAssetIds: string[],
	mediaAssets: MediaAsset[],
): GenerationAsset[] => [
	...referenceUrls.map((url) => ({ kind: "image" as const, url })),
	...referenceAssetIds.flatMap((assetID) => {
		const asset = mediaAssets.find((item) => item.id === assetID);
		if (!asset || asset.kind !== "image") return [];

		return [{ kind: asset.kind, url: asset.url, mimeType: asset.mimeType }];
	}),
];

const referenceAssetsFromTask = (task: GenerationTask, mediaAssets: MediaAsset[]) =>
	referenceAssetsFromInputs(task.referenceUrls ?? [], task.referenceAssetIds ?? [], mediaAssets);
