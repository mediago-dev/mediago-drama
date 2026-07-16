import type {
	AgentMessage,
	AgentMessageKind,
	AgentTurnLifecycle,
	AgentTurnOutcome,
} from "@/domains/agent/stores";
import { adaptAgentMessagesToTurnItems } from "@/domains/agent/lib/agent-thread-adapter";

export interface AgentTurnProjectionState {
	lifecycle?: AgentTurnLifecycle;
	outcome?: AgentTurnOutcome | null;
	startedAt?: string;
	completedAt?: string;
}

export interface BuildAgentTurnViewModelOptions {
	/** The turn receiving `activeTurn`; defaults to the final turn in display order. */
	activeTurnId?: string | null;
	/** Live run state not recoverable from a flat transcript alone. */
	activeTurn?: AgentTurnProjectionState;
	/** Optional durable state for restored historical turns. */
	turns?: Readonly<Record<string, AgentTurnProjectionState>>;
	/** Deterministic clock used to calculate elapsed time for a nonterminal turn. */
	now?: string | number | Date;
}

export interface AgentTurnProcessSummary {
	label: string;
	itemCount: number;
	reasoningCount: number;
	toolCount: number;
	fileChangeCount: number;
	hasFailure: boolean;
	durationMs?: number;
}

export interface AgentTurnViewModel {
	id: string;
	userMessage?: AgentMessage;
	processItems: AgentMessage[];
	finalAnswerItems: AgentMessage[];
	interactionItems: AgentMessage[];
	lifecycle: AgentTurnLifecycle;
	outcome: AgentTurnOutcome | null;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	processSummary: AgentTurnProcessSummary;
}

interface MutableTurnViewModel {
	id: string;
	userMessage?: AgentMessage;
	processItems: AgentMessage[];
	finalAnswerItems: AgentMessage[];
	interactionItems: AgentMessage[];
	messages: AgentMessage[];
}

/** Builds the semantic turn projection consumed by the Codex-style timeline. */
export const buildAgentTurnViewModels = (
	messages: readonly AgentMessage[],
	options: BuildAgentTurnViewModelOptions = {},
): AgentTurnViewModel[] => {
	const order: string[] = [];
	const turns = new Map<string, MutableTurnViewModel>();

	for (const item of adaptAgentMessagesToTurnItems(messages)) {
		let turn = turns.get(item.turnId);
		if (!turn) {
			turn = {
				id: item.turnId,
				processItems: [],
				finalAnswerItems: [],
				interactionItems: [],
				messages: [],
			};
			turns.set(item.turnId, turn);
			order.push(item.turnId);
		}

		turn.messages.push(item.message);
		if (item.lane === "user") {
			turn.userMessage ??= item.message;
		} else if (item.lane === "process") {
			turn.processItems.push(item.message);
		} else if (item.lane === "final") {
			turn.finalAnswerItems.push(item.message);
		} else {
			turn.interactionItems.push(item.message);
		}
	}

	const requestedActiveTurnId = options.activeTurnId;
	const activeTurnIdMatches = Boolean(requestedActiveTurnId && turns.has(requestedActiveTurnId));
	const defaultActiveTurnId = activeTurnIdMatches ? requestedActiveTurnId : (order.at(-1) ?? null);
	return order.map((turnId) => {
		const turn = turns.get(turnId)!;
		const durableState = options.turns?.[turnId];
		const activeState =
			turnId === defaultActiveTurnId
				? requestedActiveTurnId && !activeTurnIdMatches
					? projectionWithoutTiming(options.activeTurn)
					: options.activeTurn
				: undefined;
		return finalizeTurnViewModel(
			turn,
			mergeProjectionState(durableState, activeState),
			options.now,
		);
	});
};

const projectionWithoutTiming = (
	projection: AgentTurnProjectionState | undefined,
): AgentTurnProjectionState | undefined => {
	if (!projection) return undefined;
	return {
		lifecycle: projection.lifecycle,
		outcome: projection.outcome,
	};
};

const mergeProjectionState = (
	durableState: AgentTurnProjectionState | undefined,
	activeState: AgentTurnProjectionState | undefined,
): AgentTurnProjectionState | undefined => {
	if (!durableState) return activeState;
	if (!activeState) return durableState;
	return { ...durableState, ...activeState };
};

const finalizeTurnViewModel = (
	turn: MutableTurnViewModel,
	projection: AgentTurnProjectionState | undefined,
	now: BuildAgentTurnViewModelOptions["now"],
): AgentTurnViewModel => {
	const lifecycle =
		projection?.lifecycle ??
		explicitTurnLifecycle(turn.messages) ??
		inferredLifecycle(turn.messages);
	const explicitOutcome = projection?.outcome ?? explicitTurnOutcome(turn.messages);
	const outcome =
		lifecycle === "completed"
			? (explicitOutcome ?? inferredOutcome(turn.finalAnswerItems, turn.messages))
			: null;
	const timing = turnTiming(turn, lifecycle, projection, now);
	const processItems = settleTerminalPlanEntries(turn.processItems, lifecycle, outcome);
	const processSummary = summarizeProcess(processItems, lifecycle, outcome, timing.durationMs);

	return {
		id: turn.id,
		userMessage: turn.userMessage,
		processItems,
		finalAnswerItems: turn.finalAnswerItems,
		interactionItems: turn.interactionItems,
		lifecycle,
		outcome,
		startedAt: timing.startedAt,
		completedAt: timing.completedAt,
		durationMs: timing.durationMs,
		processSummary,
	};
};

const settleTerminalPlanEntries = (
	items: AgentMessage[],
	lifecycle: AgentTurnLifecycle,
	outcome: AgentTurnOutcome | null,
) => {
	if (lifecycle !== "completed") return items;

	return items.map((message) => {
		const entries = message.kind === "plan" ? message.metadata?.planEntries : undefined;
		if (!entries?.some((entry) => entry.status === "pending" || entry.status === "in_progress")) {
			return message;
		}

		const planEntries = entries.map((entry) => {
			if (
				outcome === "succeeded" &&
				(entry.status === "pending" || entry.status === "in_progress")
			) {
				return { ...entry, status: "completed" };
			}
			if (entry.status === "in_progress") return { ...entry, status: "pending" };
			return entry;
		});

		return {
			...message,
			metadata: { ...message.metadata, planEntries },
		};
	});
};

const explicitTurnLifecycle = (messages: AgentMessage[]) =>
	findLastMetadataValue(messages, ["turnLifecycle", "lifecycle"], isTurnLifecycle);

const explicitTurnOutcome = (messages: AgentMessage[]) =>
	findLastMetadataValue(messages, ["turnOutcome", "outcome"], isTurnOutcome);

const findLastMetadataValue = <T extends string>(
	messages: AgentMessage[],
	keys: string[],
	predicate: (value: unknown) => value is T,
): T | undefined => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const metadata = messages[index]?.metadata;
		if (!metadata) continue;
		for (const key of keys) {
			const value = metadata[key];
			if (predicate(value)) return value;
		}
	}
	return undefined;
};

const isTurnLifecycle = (value: unknown): value is AgentTurnLifecycle =>
	value === "pending" || value === "in_progress" || value === "waiting" || value === "completed";

const isTurnOutcome = (value: unknown): value is AgentTurnOutcome =>
	value === "succeeded" ||
	value === "failed" ||
	value === "interrupted" ||
	value === "cancelled" ||
	value === "refused";

const inferredLifecycle = (messages: AgentMessage[]): AgentTurnLifecycle => {
	const statuses = messages.map(messageRuntimeStatus);
	if (statuses.includes("waiting")) return "waiting";
	if (statuses.some((status) => status === "pending" || status === "in_progress")) {
		return "in_progress";
	}
	return "completed";
};

const messageRuntimeStatus = (message: AgentMessage) => {
	if (message.status === "streaming") return "in_progress";
	return typeof message.metadata?.status === "string" ? message.metadata.status : undefined;
};

const inferredOutcome = (
	finalAnswerItems: AgentMessage[],
	messages: AgentMessage[],
): AgentTurnOutcome => {
	if (finalAnswerItems.length > 0) return "succeeded";
	const lastAssistantMessage = findLastAssistantMessage(messages);
	return messageHasFailure(lastAssistantMessage) ? "failed" : "succeeded";
};

const findLastAssistantMessage = (messages: AgentMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "assistant") return messages[index];
	}
	return undefined;
};

const turnTiming = (
	turn: MutableTurnViewModel,
	lifecycle: AgentTurnLifecycle,
	projection: AgentTurnProjectionState | undefined,
	now: BuildAgentTurnViewModelOptions["now"],
) => {
	const projectedStart = parseTime(projection?.startedAt);
	const userStart = parseTime(turn.userMessage?.createdAt);
	const observedStarts = turn.messages.map(messageStartTime).filter(isFiniteTime);
	const startedAtMs = projectedStart ?? userStart ?? minimumTime(observedStarts);

	const projectedCompletion = parseTime(projection?.completedAt);
	const observedEnds = turn.messages.map(messageEndTime).filter(isFiniteTime);
	const completedAtMs =
		lifecycle === "completed" ? (projectedCompletion ?? maximumTime(observedEnds)) : undefined;
	const elapsedEndMs = lifecycle === "completed" ? completedAtMs : parseTime(now);
	const durationMs =
		startedAtMs !== undefined && elapsedEndMs !== undefined
			? Math.max(0, elapsedEndMs - startedAtMs)
			: undefined;

	return {
		startedAt: startedAtMs === undefined ? undefined : new Date(startedAtMs).toISOString(),
		completedAt: completedAtMs === undefined ? undefined : new Date(completedAtMs).toISOString(),
		durationMs,
	};
};

const messageStartTime = (message: AgentMessage) =>
	parseTime(
		typeof message.metadata?.startedAt === "string" ? message.metadata.startedAt : undefined,
	) ?? parseTime(message.createdAt);

const messageEndTime = (message: AgentMessage) => {
	const startedAt = messageStartTime(message);
	const durationMs = message.metadata?.durationMs;
	if (startedAt !== undefined && typeof durationMs === "number" && Number.isFinite(durationMs)) {
		return startedAt + Math.max(0, durationMs);
	}
	return parseTime(message.createdAt);
};

const parseTime = (value: string | number | Date | undefined) => {
	if (value === undefined) return undefined;
	const parsed =
		value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const isFiniteTime = (value: number | undefined): value is number => value !== undefined;

const minimumTime = (values: number[]) => (values.length > 0 ? Math.min(...values) : undefined);

const maximumTime = (values: number[]) => (values.length > 0 ? Math.max(...values) : undefined);

const summarizeProcess = (
	items: AgentMessage[],
	lifecycle: AgentTurnLifecycle,
	outcome: AgentTurnOutcome | null,
	durationMs: number | undefined,
): AgentTurnProcessSummary => ({
	label: processSummaryLabel(lifecycle, outcome),
	itemCount: items.length,
	reasoningCount: items.filter((message) => (message.kind ?? "message") === "thought").length,
	toolCount: items.filter((message) => {
		const kind = message.kind ?? "message";
		return kind === "tool" || kind === "terminal";
	}).length,
	fileChangeCount: items.filter((message) => {
		const kind = message.kind ?? "message";
		return kind === "file" || kind === "patch" || kind === "diff";
	}).length,
	hasFailure: items.some(messageHasFailure),
	durationMs,
});

const processSummaryLabel = (lifecycle: AgentTurnLifecycle, outcome: AgentTurnOutcome | null) => {
	if (lifecycle === "pending" || lifecycle === "in_progress") return "处理中";
	if (lifecycle === "waiting") return "等待确认";
	if (outcome === "failed") return "处理失败";
	if (outcome === "interrupted") return "处理已中断";
	if (outcome === "cancelled") return "已取消";
	if (outcome === "refused") return "已拒绝";
	return "已处理";
};

const messageHasFailure = (message: AgentMessage | undefined) =>
	message?.status === "error" || message?.metadata?.status === "failed";

// Temporary compatibility exports for the existing timeline while its renderer
// migrates to AgentTurnViewModel. New code should use buildAgentTurnViewModels.
export type TimelineEntry =
	| { type: "user"; message: AgentMessage }
	| { type: "assistant"; id: string; messages: AgentMessage[] };

export type AssistantRenderItem =
	| { type: "message"; message: AgentMessage }
	| { type: "thoughts"; id: string; messages: AgentMessage[] }
	| { type: "tools"; id: string; messages: AgentMessage[] };

export const buildTimelineEntries = (messages: AgentMessage[]): TimelineEntry[] => {
	const entries: TimelineEntry[] = [];
	let activeGroup: { id: string; messages: AgentMessage[] } | null = null;

	const flushGroup = () => {
		if (!activeGroup || activeGroup.messages.length === 0) return;
		entries.push({ type: "assistant", id: activeGroup.id, messages: activeGroup.messages });
		activeGroup = null;
	};

	for (const message of messages) {
		if ((message.kind ?? "message") === "runtime" && message.metadata?.runtimeLog !== true) {
			continue;
		}
		if (message.role === "user") {
			flushGroup();
			entries.push({ type: "user", message });
			continue;
		}
		if (!activeGroup) activeGroup = { id: `assistant-group-${message.id}`, messages: [] };
		activeGroup.messages.push(message);
	}

	flushGroup();
	return entries;
};

export const groupAssistantMessages = (messages: AgentMessage[]): AssistantRenderItem[] => {
	const items: AssistantRenderItem[] = [];
	let thoughtGroup: AgentMessage[] = [];
	let toolGroup: AgentMessage[] = [];

	const flushThoughts = () => {
		if (thoughtGroup.length === 0) return;
		items.push({ type: "thoughts", id: `thoughts-${thoughtGroup[0].id}`, messages: thoughtGroup });
		thoughtGroup = [];
	};
	const flushTools = () => {
		if (toolGroup.length === 0) return;
		items.push({ type: "tools", id: `tools-${toolGroup[0].id}`, messages: toolGroup });
		toolGroup = [];
	};

	for (const message of messages) {
		const kind = message.kind ?? "message";
		if (kind === "thought") {
			flushTools();
			thoughtGroup.push(message);
			continue;
		}
		if (isActionKind(kind)) {
			flushThoughts();
			toolGroup.push(message);
			continue;
		}
		flushThoughts();
		flushTools();
		items.push({ type: "message", message });
	}
	flushThoughts();
	flushTools();
	return items;
};

const actionKinds = new Set<AgentMessageKind>(["tool", "file", "patch", "diff", "terminal"]);

export const isActionKind = (kind: AgentMessageKind) => actionKinds.has(kind);
