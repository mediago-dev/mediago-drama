import { normalizeRuntimeLogMessage } from "@/domains/agent/lib/runtime-log";
import { pendingRootRunId } from "./constants";
import type {
	ActivityKind,
	AgentActivityItem,
	AgentConversationState,
	AgentConversationStatus,
	AgentItemIdentity,
	AgentMessage,
	AgentMessageKind,
	AgentMessageMetadata,
	AgentState,
} from "./types";

export const createId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeIdentityValue = (value?: string) => value?.trim() || undefined;

export const normalizeAgentItemIdentity = (
	identity?: AgentItemIdentity,
	defaults: AgentItemIdentity = {},
): AgentItemIdentity => {
	const turnId =
		normalizeIdentityValue(identity?.turnId) ?? normalizeIdentityValue(defaults.turnId);
	const itemId =
		normalizeIdentityValue(identity?.itemId) ?? normalizeIdentityValue(defaults.itemId);
	const phase = identity?.phase ?? defaults.phase;
	return {
		...(turnId && turnId !== pendingRootRunId ? { turnId } : {}),
		...(itemId ? { itemId } : {}),
		...(phase ? { phase } : {}),
	};
};

export const hasAgentItemIdentity = (identity?: AgentItemIdentity) => {
	const normalized = normalizeAgentItemIdentity(identity);
	return Boolean(normalized.turnId || normalized.itemId || normalized.phase);
};

export const agentMessageId = (identity: AgentItemIdentity | undefined, fallback: string) =>
	normalizeIdentityValue(identity?.itemId) ?? fallback;

export const withAgentItemIdentity = (
	message: AgentMessage,
	identity?: AgentItemIdentity,
	defaults: AgentItemIdentity = {},
): AgentMessage => {
	const normalized = normalizeAgentItemIdentity(identity, {
		turnId: message.turnId ?? defaults.turnId,
		itemId: message.itemId ?? defaults.itemId ?? message.id,
		phase: message.phase ?? defaults.phase,
	});
	return {
		...message,
		...(normalized.turnId ? { turnId: normalized.turnId } : {}),
		...(normalized.itemId ? { itemId: normalized.itemId } : {}),
		...(normalized.phase ? { phase: normalized.phase } : {}),
	};
};

export const messageMatchesAgentItemIdentity = (
	message: AgentMessage,
	identity?: AgentItemIdentity,
) => {
	const normalized = normalizeAgentItemIdentity(identity);
	if (!hasAgentItemIdentity(normalized)) return false;

	if (normalized.itemId) {
		if (message.itemId !== normalized.itemId && message.id !== normalized.itemId) return false;
		if (normalized.turnId && message.turnId && message.turnId !== normalized.turnId) return false;
		// The item is stable across lifecycle updates; phase is mutable classification
		// metadata (for example commentary promoted to the final answer on completion).
		return true;
	}

	if (normalized.turnId && message.turnId !== normalized.turnId) return false;
	if (normalized.phase && message.phase !== normalized.phase) return false;
	return true;
};

export const findLastMessageIndexByIdentity = (
	messages: AgentMessage[],
	identity: AgentItemIdentity,
	predicate: (message: AgentMessage) => boolean = () => true,
) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (predicate(message) && messageMatchesAgentItemIdentity(message, identity)) return index;
	}
	return -1;
};

export const latestStreamingAssistantMessageId = (messages: AgentMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message.role === "assistant" &&
			(message.kind ?? "message") === "message" &&
			message.status === "streaming"
		) {
			return message.id;
		}
	}
	return null;
};

export const bindLatestTurnIdentity = (messages: AgentMessage[], turnId: string) => {
	const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
	if (lastUserIndex < 0) return messages;
	return messages.map((message, index) =>
		index < lastUserIndex
			? message
			: withAgentItemIdentity(message, {
					turnId: message.turnId ?? turnId,
					itemId: message.itemId ?? message.id,
				}),
	);
};

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
	identity?: AgentItemIdentity,
): AgentConversationState => {
	const lastMessage = conversation.messages[conversation.messages.length - 1];
	const normalizedIdentity = normalizeAgentItemIdentity(identity, { phase: "commentary" });
	const explicitItemId = normalizeIdentityValue(identity?.itemId);
	const existingIndex = explicitItemId
		? findLastMessageIndexByIdentity(conversation.messages, normalizedIdentity, (message) =>
				Boolean(message.kind === "thought"),
			)
		: lastMessage?.kind === "thought"
			? conversation.messages.length - 1
			: -1;
	if (existingIndex >= 0) {
		const messages = [...conversation.messages];
		const existing = messages[existingIndex];
		messages[existingIndex] = withAgentItemIdentity(
			{
				...existing,
				content: existing.content + thought,
			},
			normalizedIdentity,
			{ phase: "commentary" },
		);
		return {
			...conversation,
			messages,
			status: nonTerminalConversationStatus(conversation.status),
			updatedAt: new Date().toISOString(),
		};
	}
	const id = agentMessageId(normalizedIdentity, createId("thought"));
	return appendMessageToConversation(
		conversation,
		withAgentItemIdentity(
			{
				id,
				role: "assistant",
				content: thought.trimStart(),
				kind: "thought",
				title: "思考",
				createdAt: new Date().toISOString(),
				status: "complete",
			},
			normalizedIdentity,
			{ phase: "commentary" },
		),
	);
};

export const findCurrentTurnPlanMessage = (
	messages: AgentMessage[],
	identity?: AgentItemIdentity,
) => {
	const normalizedIdentity = normalizeAgentItemIdentity(identity);
	if (normalizedIdentity.itemId) {
		const index = findLastMessageIndexByIdentity(messages, normalizedIdentity, (message) =>
			Boolean(message.kind === "plan" && message.metadata?.planEntries),
		);
		return index >= 0 ? messages[index] : undefined;
	}
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
	identity?: AgentItemIdentity,
	fallbackIdentity: AgentItemIdentity = { phase: "final_answer" },
) => {
	const normalizedIdentity = normalizeAgentItemIdentity(identity, fallbackIdentity);
	const usesSemanticRouting = hasAgentItemIdentity(identity);
	let streamingIndex = usesSemanticRouting
		? findLastMessageIndexByIdentity(conversation.messages, normalizedIdentity, (message) =>
				Boolean(
					message.role === "assistant" &&
					(message.kind ?? "message") === "message" &&
					(Boolean(normalizedIdentity.itemId) || message.status === "streaming"),
				),
			)
		: -1;
	if (streamingIndex < 0 && !usesSemanticRouting && conversation.streamingMessageId) {
		streamingIndex = conversation.messages.findIndex(
			(message) => message.id === conversation.streamingMessageId,
		);
	}
	const completedContent = normalizedIdentity.itemId
		? stripPriorAssistantMessageAggregatePrefix(
				conversation.messages,
				streamingIndex >= 0 ? streamingIndex : conversation.messages.length,
				normalizedIdentity,
				content,
			)
		: content;

	if (streamingIndex < 0) {
		if (!completedContent.trim()) return conversation.messages;
		const id = agentMessageId(normalizedIdentity, createId("assistant"));
		return [
			...conversation.messages,
			withAgentItemIdentity(
				{
					id,
					role: "assistant" as const,
					content: completedContent,
					kind: "message" as const,
					createdAt: new Date().toISOString(),
					status: "complete" as const,
				},
				normalizedIdentity,
				{ phase: "final_answer" },
			),
		];
	}

	return conversation.messages.map((message, index) =>
		index === streamingIndex
			? withAgentItemIdentity(
					{
						...message,
						content:
							completedContent &&
							(usesSemanticRouting ||
								!shouldPreserveSegmentedStreamingContent(conversation, streamingIndex))
								? completedContent
								: message.content,
						status: "complete" as const,
					},
					normalizedIdentity,
					{ phase: "final_answer" },
				)
			: message,
	);
};

const stripPriorAssistantMessageAggregatePrefix = (
	messages: AgentMessage[],
	targetIndex: number,
	identity: AgentItemIdentity,
	content: string,
) => {
	if (!content || targetIndex <= 0) return content;
	const lastUserIndex = findLastIndex(
		messages.slice(0, targetIndex),
		(message) => message.role === "user",
	);
	const prefix = messages
		.slice(lastUserIndex + 1, targetIndex)
		.filter(
			(message) =>
				message.role === "assistant" &&
				(message.kind ?? "message") === "message" &&
				!message.metadata?.a2ui &&
				!message.metadata?.form &&
				(!identity.turnId || !message.turnId || message.turnId === identity.turnId) &&
				(!identity.itemId || message.itemId !== identity.itemId),
		)
		.map((message) => message.content)
		.join("");
	return prefix && content.startsWith(prefix) ? content.slice(prefix.length) : content;
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

const latestConversationWithMessages = (
	conversations: Record<string, AgentConversationState>,
): AgentConversationState | undefined => {
	let latest: AgentConversationState | undefined;
	for (const conversation of Object.values(conversations)) {
		if (conversation.messages.length === 0) continue;
		if (!latest || conversationUpdatedTime(conversation) >= conversationUpdatedTime(latest)) {
			latest = conversation;
		}
	}
	return latest;
};

// Prefer the bound root conversation, but never let a stale/mismatched rootRunId —
// or an empty conversation a hydrate/bind left pointed at — blank the timeline:
// fall back to the most recently updated conversation that actually has messages.
export const resolveActiveConversation = (
	conversations: Record<string, AgentConversationState>,
	rootRunId: string | null,
) => {
	const root = rootConversation(conversations, rootRunId);
	if (root && root.messages.length > 0) return root;
	return latestConversationWithMessages(conversations) ?? root ?? latestConversation(conversations);
};

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
