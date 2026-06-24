import { normalizeRuntimeLogMessage } from "@/domains/agent/lib/runtime-log";
import { pendingRootRunId } from "./constants";
import type {
	ActivityKind,
	AgentActivityItem,
	AgentConversationState,
	AgentConversationStatus,
	AgentMessage,
	AgentMessageKind,
	AgentMessageMetadata,
	AgentState,
} from "./types";

export const createId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const createConversation = (
	runId: string,
	options: Partial<AgentConversationState> = {},
): AgentConversationState => {
	const now = new Date().toISOString();
	return {
		runId,
		name: options.name,
		prompt: options.prompt,
		status: options.status ?? "pending",
		messages: options.messages ?? [],
		streamingMessageId: options.streamingMessageId ?? null,
		children: options.children ?? [],
		createdAt: options.createdAt ?? now,
		updatedAt: options.updatedAt ?? now,
	};
};

export const normalizeAgentMessages = (messages: AgentMessage[]) =>
	messages
		.map(normalizeRuntimeLogMessage)
		.filter(isPersistentAgentMessage)
		.map((message) => ({
			...message,
			kind: message.kind ?? "message",
			createdAt: message.createdAt ?? new Date().toISOString(),
			status:
				message.status === "streaming" ? ("complete" as const) : (message.status ?? "complete"),
		}));

export const normalizeAgentActivity = (activity: AgentActivityItem[]) =>
	activity.map((item) => ({
		...item,
		createdAt: item.createdAt ?? new Date().toISOString(),
	}));

export const normalizeAgentConversations = (
	conversations: Record<string, AgentConversationState>,
): Record<string, AgentConversationState> => {
	const normalized: Record<string, AgentConversationState> = {};
	for (const [runId, conversation] of Object.entries(conversations)) {
		const id = (conversation.runId || runId).trim();
		if (!id) continue;
		normalized[id] = {
			...conversation,
			runId: id,
			name: conversation.name?.trim() || "主智能体",
			status: normalizeConversationStatus(conversation.status),
			messages: normalizeAgentMessages(conversation.messages ?? []),
			streamingMessageId: conversation.streamingMessageId ?? null,
			children: Array.isArray(conversation.children) ? [...conversation.children] : [],
			createdAt: conversation.createdAt ?? new Date().toISOString(),
			updatedAt: conversation.updatedAt ?? conversation.createdAt ?? new Date().toISOString(),
		};
	}
	return normalized;
};

export const normalizeConversationStatus = (
	status: AgentConversationStatus | string | undefined,
): AgentConversationStatus => {
	if (
		status === "pending" ||
		status === "running" ||
		status === "waiting" ||
		status === "completed" ||
		status === "failed" ||
		status === "interrupted" ||
		status === "paused" ||
		status === "cancelled"
	) {
		return status;
	}
	return "completed";
};

export const normalizeEventSequence = (sequence?: number | string | null) => {
	const value = String(sequence ?? "").trim();
	if (!value) return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return String(parsed);
};

export const resolveTargetRunId = (
	state: Pick<AgentState, "rootRunId" | "conversations">,
	runId?: string,
) => {
	const trimmed = runId?.trim();
	if (trimmed) return trimmed;
	if (state.rootRunId) return state.rootRunId;
	return pendingRootRunId;
};

export const updateConversationMessages = (
	state: Pick<AgentState, "conversations">,
	runId: string,
	updater: (conversation: AgentConversationState) => AgentConversationState,
) => {
	const existing = state.conversations[runId] ?? createConversation(runId, { status: "running" });
	return {
		...state.conversations,
		[runId]: updater(existing),
	};
};

export const appendTraceForTarget = (
	state: Pick<AgentState, "conversations">,
	runId: string,
	kind: ActivityKind,
	label: string,
	detail: string,
) =>
	updateConversationMessages(state, runId, (conversation) =>
		appendTraceToConversation(conversation, kind, label, detail),
	);

export const appendTraceToConversation = (
	conversation: AgentConversationState,
	kind: ActivityKind,
	label: string,
	detail: string,
) => {
	const message = traceMessage(kind, label, detail);
	if (!isPersistentAgentMessage(message)) return conversation;
	return appendMessageToConversation(conversation, {
		...message,
		metadata: metadataFromTraceMessage(message.kind ?? "message", label, detail),
	});
};

export const appendMessageToConversation = (
	conversation: AgentConversationState,
	message: AgentMessage,
): AgentConversationState => ({
	...conversation,
	messages: [...conversation.messages, message],
	updatedAt: new Date().toISOString(),
});

// Thought chunks stream at token granularity; storing one message per chunk
// makes the timeline grow by thousands of entries per run. Consecutive chunks
// are merged into the trailing thought message instead, keeping the raw chunk
// spacing so the merged text reads exactly as the agent produced it.
export const appendThoughtToConversation = (
	conversation: AgentConversationState,
	thought: string,
): AgentConversationState => {
	const lastMessage = conversation.messages[conversation.messages.length - 1];
	if (lastMessage?.kind === "thought") {
		const messages = [...conversation.messages];
		messages[messages.length - 1] = {
			...lastMessage,
			content: lastMessage.content + thought,
		};
		return {
			...conversation,
			messages,
			status: nonTerminalConversationStatus(conversation.status),
			updatedAt: new Date().toISOString(),
		};
	}
	return appendMessageToConversation(conversation, {
		id: createId("thought"),
		role: "assistant",
		content: thought.trimStart(),
		kind: "thought",
		title: "思考",
		createdAt: new Date().toISOString(),
		status: "complete",
	});
};

export const findCurrentTurnPlanMessage = (messages: AgentMessage[]) => {
	const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
	return messages.find(
		(message, index) =>
			index > lastUserIndex && message.kind === "plan" && message.metadata?.planEntries,
	);
};

export const findLastIndex = <T>(items: T[], predicate: (item: T) => boolean) => {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (predicate(items[index])) return index;
	}
	return -1;
};

export const completeConversationAssistantMessage = (
	conversation: AgentConversationState,
	content: string,
) => {
	if (!conversation.streamingMessageId) {
		if (!content.trim()) return conversation.messages;
		return [
			...conversation.messages,
			{
				id: createId("assistant"),
				role: "assistant" as const,
				content,
				kind: "message" as const,
				createdAt: new Date().toISOString(),
				status: "complete" as const,
			},
		];
	}

	const streamingIndex = conversation.messages.findIndex(
		(message) => message.id === conversation.streamingMessageId,
	);
	return conversation.messages.map((message, index) =>
		message.id === conversation.streamingMessageId
			? {
					...message,
					content:
						content && !shouldPreserveSegmentedStreamingContent(conversation, streamingIndex)
							? content
							: message.content,
					status: "complete" as const,
				}
			: index === streamingIndex
				? { ...message, status: "complete" as const }
				: message,
	);
};

export const completeStreamingMessageInConversation = (
	conversation: AgentConversationState,
): AgentConversationState => {
	if (!conversation.streamingMessageId) return conversation;
	return {
		...conversation,
		streamingMessageId: null,
		messages: conversation.messages.map((message) =>
			message.id === conversation.streamingMessageId
				? { ...message, status: "complete" as const }
				: message,
		),
	};
};

const shouldPreserveSegmentedStreamingContent = (
	conversation: AgentConversationState,
	streamingIndex: number,
) => {
	if (streamingIndex < 0) return false;
	const lastUserIndex = findLastIndex(conversation.messages, (message) => message.role === "user");
	return conversation.messages.some(
		(message, index) =>
			index > lastUserIndex &&
			index < streamingIndex &&
			message.role === "assistant" &&
			(message.kind ?? "message") !== "runtime",
	);
};

export const finishConversation = (
	conversation: AgentConversationState,
	status: Extract<AgentConversationStatus, "completed" | "failed" | "cancelled">,
): AgentConversationState => ({
	...conversation,
	status,
	streamingMessageId: null,
	messages: conversation.messages.map((message) =>
		message.status === "streaming" ? { ...message, status: "complete" as const } : message,
	),
	updatedAt: new Date().toISOString(),
});

export const statePatchWithConversations = (
	state: Pick<AgentState, "rootRunId">,
	conversations: Record<string, AgentConversationState>,
) => {
	const root = rootConversation(conversations, state.rootRunId);
	return {
		conversations,
		streamingMessageId: root?.streamingMessageId ?? null,
		isRunning: deriveIsRunning(conversations),
	};
};

export const rootConversation = (
	conversations: Record<string, AgentConversationState>,
	rootRunId: string | null,
) => (rootRunId ? conversations[rootRunId] : undefined);

const conversationUpdatedTime = (conversation: AgentConversationState) => {
	const value = Date.parse(conversation.updatedAt ?? "");
	return Number.isFinite(value) ? value : 0;
};

export const latestConversation = (
	conversations: Record<string, AgentConversationState>,
): AgentConversationState | undefined => {
	let latest: AgentConversationState | undefined;
	for (const conversation of Object.values(conversations)) {
		if (!latest || conversationUpdatedTime(conversation) >= conversationUpdatedTime(latest)) {
			latest = conversation;
		}
	}
	return latest;
};

export const latestConversationRunId = (
	conversations: Record<string, AgentConversationState>,
): string | null => latestConversation(conversations)?.runId ?? null;

// Prefer the bound root conversation, but never let a stale/mismatched rootRunId
// blank the timeline: fall back to the most recently updated conversation.
export const resolveActiveConversation = (
	conversations: Record<string, AgentConversationState>,
	rootRunId: string | null,
) => rootConversation(conversations, rootRunId) ?? latestConversation(conversations);

export const deriveIsRunning = (conversations: Record<string, AgentConversationState>) =>
	Object.values(conversations).some(
		(conversation) => !isTerminalConversationStatus(conversation.status),
	);

export const isTerminalConversationStatus = (status: AgentConversationStatus) =>
	status === "completed" ||
	status === "failed" ||
	status === "cancelled" ||
	status === "paused" ||
	status === "interrupted";

export const nonTerminalConversationStatus = (
	status: AgentConversationStatus,
): AgentConversationStatus =>
	isTerminalConversationStatus(status) ? "running" : status === "pending" ? "running" : status;

export const mapConversations = (
	conversations: Record<string, AgentConversationState>,
	mapper: (conversation: AgentConversationState) => AgentConversationState,
) =>
	Object.fromEntries(
		Object.entries(conversations).map(([runId, conversation]) => [runId, mapper(conversation)]),
	) as Record<string, AgentConversationState>;

export const prependActivity = (
	activity: AgentActivityItem[],
	kind: ActivityKind,
	label: string,
	detail: string,
) => [
	{
		id: createId(kind),
		kind,
		label,
		detail,
		createdAt: new Date().toISOString(),
	},
	...activity,
];

export const traceMessage = (kind: ActivityKind, label: string, detail: string): AgentMessage => ({
	id: createId(kind),
	role: "assistant",
	content: detail,
	kind,
	title: label,
	createdAt: new Date().toISOString(),
	status: "complete",
});

export const isPersistentAgentMessage = (message: AgentMessage) => {
	const title = message.title ?? "";
	const content = message.content ?? "";

	if (message.kind === "runtime" && message.metadata?.runtimeLog !== true) return false;
	if (message.kind === "patch" && title === "开始编辑文档") return false;
	if (message.kind === "patch" && title === "文档已更新" && content.includes("流式编辑已完成")) {
		return false;
	}

	return true;
};

export const runtimeLabel = (runtime: string) => {
	if (runtime === "acp") return "ACP";
	if (runtime === "mock" || runtime === "frontend-mock") return "模拟运行时";
	return "未知";
};

const metadataFromTraceMessage = (
	kind: AgentMessageKind,
	label: string,
	detail: string,
): AgentMessageMetadata | undefined => {
	if (kind === "tool") {
		return {
			toolName: label,
			outputResult: detail,
		};
	}
	if (kind === "file") {
		return {
			outputResult: detail,
		};
	}
	if (kind === "patch") {
		return {
			outputResult: detail,
		};
	}
	return undefined;
};
