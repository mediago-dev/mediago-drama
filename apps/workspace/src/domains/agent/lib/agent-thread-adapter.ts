import type { AgentMessage, AgentMessageKind, AgentMessagePhase } from "@/domains/agent/stores";

export type AgentTurnItemLane = "user" | "process" | "final" | "interaction";

export interface AdaptedAgentTurnItem {
	turnId: string;
	itemId: string;
	lane: AgentTurnItemLane;
	message: AgentMessage;
}

const processKinds = new Set<AgentMessageKind>([
	"thought",
	"tool",
	"file",
	"plan",
	"patch",
	"terminal",
	"diff",
]);

/**
 * Converts both current semantic messages and legacy flat transcript records into
 * deterministic turn items. Content inspection is limited to old `<think>`
 * envelopes and exact aggregate-prefix deduplication; lanes never depend on
 * message length or Markdown.
 */
export const adaptAgentMessagesToTurnItems = (
	messages: readonly AgentMessage[],
): AdaptedAgentTurnItem[] => {
	const items: AdaptedAgentTurnItem[] = [];
	let activeTurnId: string | null = null;
	let orphanTurnId: string | null = null;

	for (const [index, sourceMessage] of messages.entries()) {
		if (isHiddenRuntimeTrace(sourceMessage)) continue;

		const fallbackItemId = stableSourceId(sourceMessage, index);
		const explicitTurnId = normalizedIdentity(sourceMessage.turnId);
		let turnId: string;

		if (sourceMessage.role === "user") {
			turnId = explicitTurnId ?? `legacy-turn:${fallbackItemId}`;
			activeTurnId = turnId;
		} else if (explicitTurnId) {
			if (activeTurnId?.startsWith("legacy-turn:")) {
				remapTurn(items, activeTurnId, explicitTurnId);
			}
			turnId = explicitTurnId;
			activeTurnId = explicitTurnId;
		} else if (activeTurnId) {
			turnId = activeTurnId;
		} else {
			orphanTurnId ??= `legacy-turn:orphan:${fallbackItemId}`;
			turnId = orphanTurnId;
			activeTurnId = orphanTurnId;
		}

		const itemId = normalizedIdentity(sourceMessage.itemId) ?? fallbackItemId;
		const normalizedMessage: AgentMessage = {
			...sourceMessage,
			itemId,
			turnId,
		};

		if (shouldSplitInlineThoughts(normalizedMessage)) {
			items.push(...splitInlineThoughtItems(normalizedMessage, turnId, itemId));
			continue;
		}

		const lane = laneForMessage(normalizedMessage);
		items.push({
			turnId,
			itemId,
			lane,
			message: withInferredPhase(normalizedMessage, lane),
		});
	}

	return stripAggregateProcessPrefix(recoverMessagesBeforeProcessBoundaries(items));
};

/**
 * Legacy transcripts persisted assistant progress paragraphs as ordinary messages.
 * A later structural process item proves those earlier paragraphs were commentary;
 * the final ordinary message after the last structural boundary remains the answer.
 */
const recoverMessagesBeforeProcessBoundaries = (items: AdaptedAgentTurnItem[]) => {
	const turnsWithLaterProcessBoundary = new Set<string>();

	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) continue;
		if (isStructuralProcessBoundary(item.message)) {
			turnsWithLaterProcessBoundary.add(item.turnId);
			continue;
		}
		if (!turnsWithLaterProcessBoundary.has(item.turnId) || !isRecoverableAssistantMessage(item)) {
			continue;
		}

		item.lane = "process";
		item.message = withInferredPhase(item.message, "process");
	}

	return items;
};

const isStructuralProcessBoundary = (message: AgentMessage) =>
	message.role === "assistant" && processKinds.has(message.kind ?? "message");

const isRecoverableAssistantMessage = (item: AdaptedAgentTurnItem) =>
	item.lane === "final" &&
	item.message.role === "assistant" &&
	(item.message.kind ?? "message") === "message";

interface AggregateFinalCandidate {
	item: AdaptedAgentTurnItem;
	processPrefix: string;
}

/**
 * Older completed events may contain every streamed message segment again in
 * the last final item. Remove that duplication only when the preceding process
 * narration is an exact, ordered prefix; no content heuristics are involved.
 */
const stripAggregateProcessPrefix = (items: AdaptedAgentTurnItem[]) => {
	const processPrefixByTurn = new Map<string, string>();
	const finalCandidateByTurn = new Map<string, AggregateFinalCandidate>();

	for (const item of items) {
		if (isProcessNarration(item)) {
			const prefix = processPrefixByTurn.get(item.turnId) ?? "";
			processPrefixByTurn.set(item.turnId, prefix + item.message.content);
			continue;
		}
		if (isRecoverableAssistantMessage(item)) {
			finalCandidateByTurn.set(item.turnId, {
				item,
				processPrefix: processPrefixByTurn.get(item.turnId) ?? "",
			});
		}
	}

	for (const { item, processPrefix } of finalCandidateByTurn.values()) {
		if (!processPrefix || !item.message.content.startsWith(processPrefix)) continue;
		item.message = {
			...item.message,
			content: item.message.content.slice(processPrefix.length),
		};
	}

	return items;
};

const isProcessNarration = (item: AdaptedAgentTurnItem) =>
	item.lane === "process" &&
	item.message.role === "assistant" &&
	(item.message.kind ?? "message") === "message";

const stableSourceId = (message: AgentMessage, index: number) =>
	normalizedIdentity(message.itemId) ?? normalizedIdentity(message.id) ?? `message-${index}`;

const normalizedIdentity = (value: string | undefined) => {
	const normalized = value?.trim();
	return normalized || undefined;
};

const remapTurn = (items: AdaptedAgentTurnItem[], fromTurnId: string, toTurnId: string) => {
	for (const item of items) {
		if (item.turnId !== fromTurnId) continue;
		item.turnId = toTurnId;
		item.message = { ...item.message, turnId: toTurnId };
	}
};

const isHiddenRuntimeTrace = (message: AgentMessage) =>
	(message.kind ?? "message") === "runtime" && message.metadata?.runtimeLog !== true;

const laneForMessage = (message: AgentMessage): AgentTurnItemLane => {
	if (message.role === "user") return "user";
	if (message.metadata?.form || message.metadata?.a2ui) return "interaction";

	const kind = message.kind ?? "message";
	if (kind === "runtime" || processKinds.has(kind)) return "process";
	return message.phase === "commentary" ? "process" : "final";
};

const withInferredPhase = (message: AgentMessage, lane: AgentTurnItemLane): AgentMessage => {
	if (message.role !== "assistant" || lane === "interaction") return message;
	const phase: AgentMessagePhase = lane === "final" ? "final_answer" : "commentary";
	return message.phase === phase ? message : { ...message, phase };
};

const shouldSplitInlineThoughts = (message: AgentMessage) =>
	message.role === "assistant" &&
	(message.kind ?? "message") === "message" &&
	!message.metadata?.form &&
	!message.metadata?.a2ui &&
	/<think>/i.test(message.content);

interface InlineThoughtSegment {
	type: "text" | "thought";
	content: string;
}

const splitInlineThoughtItems = (
	message: AgentMessage,
	turnId: string,
	baseItemId: string,
): AdaptedAgentTurnItem[] => {
	const counters = { text: 0, thought: 0 };
	return parseInlineThoughtSegments(message.content).map((segment) => {
		const segmentIndex = counters[segment.type];
		counters[segment.type] += 1;
		const suffix = segment.type === "thought" ? "thought" : "text";
		const itemId = `${baseItemId}:${suffix}:${segmentIndex}`;
		const lane: AgentTurnItemLane =
			segment.type === "thought" || message.phase === "commentary" ? "process" : "final";
		const phase: AgentMessagePhase = lane === "process" ? "commentary" : "final_answer";
		const splitMessage: AgentMessage = {
			...message,
			id: `${message.id}:${suffix}:${segmentIndex}`,
			itemId,
			turnId,
			content: segment.content,
			kind: segment.type === "thought" ? "thought" : "message",
			phase,
			title: segment.type === "thought" ? message.title || "思考" : message.title,
		};
		return { turnId, itemId, lane, message: splitMessage };
	});
};

const parseInlineThoughtSegments = (content: string): InlineThoughtSegment[] => {
	const segments: InlineThoughtSegment[] = [];
	const openPattern = /<think>/gi;
	let cursor = 0;
	let openMatch: RegExpExecArray | null;

	while ((openMatch = openPattern.exec(content)) !== null) {
		pushInlineSegment(segments, "text", content.slice(cursor, openMatch.index));
		const thoughtStart = openPattern.lastIndex;
		const closePattern = /<\/think>/gi;
		closePattern.lastIndex = thoughtStart;
		const closeMatch = closePattern.exec(content);
		if (!closeMatch) {
			pushInlineSegment(segments, "thought", content.slice(thoughtStart));
			cursor = content.length;
			break;
		}

		pushInlineSegment(segments, "thought", content.slice(thoughtStart, closeMatch.index));
		cursor = closeMatch.index + closeMatch[0].length;
		openPattern.lastIndex = cursor;
	}

	if (cursor < content.length) pushInlineSegment(segments, "text", content.slice(cursor));
	return segments;
};

const pushInlineSegment = (
	segments: InlineThoughtSegment[],
	type: InlineThoughtSegment["type"],
	content: string,
) => {
	const normalized = content.trim();
	if (normalized) segments.push({ type, content: normalized });
};
