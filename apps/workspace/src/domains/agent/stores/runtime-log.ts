import {
	agentMessageId,
	createId,
	findLastMessageIndexByIdentity,
	nonTerminalConversationStatus,
	normalizeAgentItemIdentity,
	withAgentItemIdentity,
} from "./conversation";
import type {
	AgentACPContentBlock,
	AgentConversationState,
	AgentItemIdentity,
	AgentMessage,
	AgentMessageMetadata,
	AgentToolCallStatus,
} from "./types";

export const upsertRuntimeLogInConversation = (
	conversation: AgentConversationState,
	input: {
		content?: string;
		outputBlocks?: AgentACPContentBlock[];
		outputJson?: unknown;
		status?: AgentToolCallStatus;
		toolCallId?: string;
	},
	identity?: AgentItemIdentity,
): AgentConversationState => {
	const now = new Date().toISOString();
	const toolCallId = input.toolCallId?.trim();
	const normalizedIdentity = normalizeAgentItemIdentity(identity, { phase: "commentary" });
	const identityIndex = normalizedIdentity.itemId
		? findLastMessageIndexByIdentity(conversation.messages, normalizedIdentity, (message) =>
				Boolean(message.kind === "runtime" && message.metadata?.runtimeLog === true),
			)
		: -1;
	const toolCallExisting = toolCallId
		? conversation.messages.find(
				(message) =>
					message.kind === "runtime" &&
					message.metadata?.runtimeLog === true &&
					message.metadata.toolCallId === toolCallId,
			)
		: undefined;
	const existing =
		(identityIndex >= 0 ? conversation.messages[identityIndex] : undefined) ??
		(!normalizedIdentity.itemId || !toolCallExisting?.itemId ? toolCallExisting : undefined);
	const previousMetadata = existing?.metadata ?? {};
	const startedAt =
		typeof previousMetadata.startedAt === "string" ? previousMetadata.startedAt : now;
	const nextStatus = input.status ?? previousMetadata.status;
	const outputBlocks =
		input.outputBlocks !== undefined ? input.outputBlocks : previousMetadata.outputBlocks;
	const outputJson =
		input.outputJson !== undefined ? input.outputJson : previousMetadata.outputJson;
	const measurement = measureRuntimeLogOutput(outputBlocks, outputJson);
	const durationMs =
		isTerminalStatus(nextStatus) && startedAt
			? Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime())
			: previousMetadata.durationMs;
	const nextMetadata: AgentMessageMetadata = {
		...previousMetadata,
		...definedMetadata({
			toolName: "运行日志",
			runtimeLog: true,
			toolCallId,
			status: nextStatus,
			durationMs,
			outputJson,
			outputBlocks,
			bytes: measurement.bytes,
			lines: measurement.lines,
			startedAt,
		}),
	};
	const content =
		input.content?.trim() ||
		outputBlocks?.map(runtimeLogBlockText).filter(Boolean).join("\n") ||
		(outputJson === undefined ? "" : stringifyOutput(outputJson)) ||
		existing?.content ||
		"运行日志";
	const id = existing?.id ?? agentMessageId(normalizedIdentity, createId("runtime"));
	const message: AgentMessage = withAgentItemIdentity(
		{
			id,
			role: "assistant",
			content,
			kind: "runtime",
			title: "运行日志",
			createdAt: existing?.createdAt ?? now,
			status: messageStatusFromRuntimeStatus(nextStatus),
			metadata: nextMetadata,
		},
		normalizedIdentity,
		{
			turnId: existing?.turnId,
			itemId: existing?.itemId ?? id,
			phase: existing?.phase ?? "commentary",
		},
	);
	const messages = existing
		? conversation.messages.map((item) => (item.id === existing.id ? message : item))
		: [...conversation.messages, message];

	return {
		...conversation,
		messages,
		status: nonTerminalConversationStatus(conversation.status),
		updatedAt: now,
	};
};

const definedMetadata = (metadata: AgentMessageMetadata): AgentMessageMetadata =>
	Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));

const messageStatusFromRuntimeStatus = (
	status: AgentToolCallStatus | undefined,
): AgentMessage["status"] => {
	if (status === "failed") return "error";
	if (status === "pending" || status === "in_progress") return "streaming";
	return "complete";
};

const isTerminalStatus = (status: AgentToolCallStatus | undefined) =>
	status === "completed" || status === "failed";

const measureRuntimeLogOutput = (blocks?: AgentACPContentBlock[], outputJson?: unknown) => {
	const text = [
		...(blocks ?? []).map(runtimeLogBlockText),
		outputJson === undefined ? "" : stringifyOutput(outputJson),
	]
		.filter(Boolean)
		.join("\n");
	return {
		bytes: new TextEncoder().encode(text).length,
		lines: countLines(text),
	};
};

const runtimeLogBlockText = (block: AgentACPContentBlock) => {
	if (block.type === "diff") return [block.oldText, block.newText].filter(Boolean).join("\n");
	return block.text ?? block.terminalId ?? "";
};

const stringifyOutput = (value: unknown) => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

const countLines = (text: string) => {
	if (!text) return 0;
	return text.split(/\r\n|\r|\n/).length;
};
