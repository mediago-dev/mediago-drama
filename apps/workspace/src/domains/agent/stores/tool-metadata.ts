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

export const upsertToolCallInConversation = (
	conversation: AgentConversationState,
	toolCallId: string,
	patch: Partial<AgentMessageMetadata> & {
		title?: string;
		content?: string;
		status?: AgentToolCallStatus;
		outputBlocks?: AgentACPContentBlock[];
	},
	identity?: AgentItemIdentity,
): AgentConversationState => {
	const now = new Date().toISOString();
	const normalizedIdentity = normalizeAgentItemIdentity(identity, { phase: "commentary" });
	const identityIndex = normalizedIdentity.itemId
		? findLastMessageIndexByIdentity(conversation.messages, normalizedIdentity, (message) =>
				Boolean(message.kind === "tool"),
			)
		: -1;
	const toolCallExisting = conversation.messages.find(
		(message) => message.metadata?.toolCallId === toolCallId,
	);
	const existing =
		(identityIndex >= 0 ? conversation.messages[identityIndex] : undefined) ??
		(!normalizedIdentity.itemId || !toolCallExisting?.itemId ? toolCallExisting : undefined);
	const previousMetadata = existing?.metadata ?? {};
	const startedAt =
		typeof previousMetadata.startedAt === "string" ? previousMetadata.startedAt : now;
	const nextStatus = patch.status ?? previousMetadata.status;
	const outputBlocks =
		patch.outputBlocks !== undefined ? patch.outputBlocks : previousMetadata.outputBlocks;
	const outputJson =
		patch.outputJson !== undefined ? patch.outputJson : previousMetadata.outputJson;
	const measurement = measureACPOutput(outputBlocks, outputJson);
	const durationMs =
		isTerminalToolCallStatus(nextStatus) && startedAt
			? Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime())
			: previousMetadata.durationMs;
	const nextMetadata: AgentMessageMetadata = {
		...previousMetadata,
		...definedMetadata({
			toolName: patch.toolName ?? patch.title,
			acpKind: patch.acpKind,
			toolCallId,
			status: nextStatus,
			durationMs,
			inputJson: patch.inputJson,
			outputJson,
			outputBlocks,
			locations: patch.locations,
			bytes: measurement.bytes,
			lines: measurement.lines,
			startedAt,
		}),
	};
	const content =
		patch.content ??
		toolCallContentSummary(nextMetadata) ??
		existing?.content ??
		patch.title ??
		"ACP 工具调用";
	const id = existing?.id ?? agentMessageId(normalizedIdentity, createId("tool"));
	const message: AgentMessage = withAgentItemIdentity(
		{
			id,
			role: "assistant",
			content,
			kind: "tool",
			title: patch.title ?? existing?.title ?? nextMetadata.toolName ?? "工具调用",
			createdAt: existing?.createdAt ?? now,
			status: agentMessageStatusFromToolStatus(nextStatus),
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

const agentMessageStatusFromToolStatus = (
	status: AgentToolCallStatus | undefined,
): AgentMessage["status"] => {
	if (status === "failed") return "error";
	if (status === "pending" || status === "in_progress") return "streaming";
	return "complete";
};

const isTerminalToolCallStatus = (status: AgentToolCallStatus | undefined) =>
	status === "completed" || status === "failed";

const toolCallContentSummary = (metadata: AgentMessageMetadata) => {
	const status = metadata.status ? `状态：${metadata.status}` : "";
	const lines = typeof metadata.lines === "number" ? `${metadata.lines} lines` : "";
	const bytes = typeof metadata.bytes === "number" ? formatByteCount(metadata.bytes) : "";
	return [status, lines, bytes].filter(Boolean).join(" · ");
};

const measureACPOutput = (blocks?: AgentACPContentBlock[], outputJson?: unknown) => {
	const text = [
		...(blocks ?? []).map(acpContentBlockText),
		outputJson === undefined ? "" : stringifyMetadataJson(outputJson),
	]
		.filter(Boolean)
		.join("\n");
	return {
		bytes: new TextEncoder().encode(text).length,
		lines: countLines(text),
	};
};

const acpContentBlockText = (block: AgentACPContentBlock) => {
	if (block.type === "diff") return [block.oldText, block.newText].filter(Boolean).join("\n");
	return block.text ?? block.terminalId ?? "";
};

const stringifyMetadataJson = (value: unknown) => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

const countLines = (value: string) => {
	if (!value) return 0;
	return value.split(/\r\n|\r|\n/).length;
};

const formatByteCount = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
};
