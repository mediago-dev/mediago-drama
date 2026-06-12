import type { AgentRuntimeACPEvent } from "@/domains/agent/api/agent";
import type { AgentMessage } from "@/domains/agent/stores/types";

const runtimeLogMarkers = [
	"codex_core::session",
	"failed to load skill",
	"missing yaml frontmatter",
	"/.agents/skills/",
	"error codex_core",
];

const defaultToolTitles = new Set(["工具调用", "ACP 工具调用", "tool call", "tool_call"]);

export const isACPToolRuntimeLog = (acp: AgentRuntimeACPEvent) => {
	if (acp.kind !== "toolCall" && acp.kind !== "toolCallUpdate") return false;
	const toolKind = acp.toolKind?.trim();
	if (toolKind && toolKind !== "other") return false;
	const toolCallId = acp.toolCallId?.trim() || "";
	if (displayACPToolTitle(acp.title, toolCallId)) return false;
	if (acp.locations?.length) return false;
	if (acp.rawInput !== undefined && acp.rawInput !== null) return false;
	if (acp.content?.some((block) => block.type === "diff")) return false;

	const text = normalizeRuntimeLogText(acpRuntimeLogText(acp));
	return isRuntimeLogText(text);
};

export const acpRuntimeLogText = (acp: AgentRuntimeACPEvent) => {
	const blockText =
		acp.content
			?.map((block) =>
				block.type === "diff"
					? [block.oldText, block.newText].filter(Boolean).join("\n")
					: (block.text ?? block.terminalId ?? ""),
			)
			.filter(Boolean)
			.join("\n") ?? "";
	return [blockText, rawRuntimeLogText(acp.rawOutput)].filter(Boolean).join("\n");
};

export const containsRuntimeLogMarkers = (text: string) =>
	isRuntimeLogText(normalizeRuntimeLogText(text));

export const normalizeRuntimeLogMessage = (message: AgentMessage): AgentMessage => {
	if (message.kind === "runtime" && message.metadata?.runtimeLog === true) {
		return {
			...message,
			title: "运行日志",
			metadata: {
				...message.metadata,
				toolName: "运行日志",
				runtimeLog: true,
			},
		};
	}
	if (!isLegacyToolRuntimeLogMessage(message)) return message;
	return {
		...message,
		kind: "runtime",
		title: "运行日志",
		metadata: {
			...message.metadata,
			toolName: "运行日志",
			runtimeLog: true,
		},
	};
};

export const isLegacyToolRuntimeLogMessage = (message: AgentMessage) => {
	if ((message.kind ?? "message") !== "tool") return false;
	const metadata = message.metadata ?? {};
	if (metadata.runtimeLog === true) return true;
	const acpKind = typeof metadata.acpKind === "string" ? metadata.acpKind.trim() : "";
	if (acpKind && acpKind !== "other") return false;
	const toolCallId = typeof metadata.toolCallId === "string" ? metadata.toolCallId.trim() : "";
	const title = displayACPToolTitle(
		typeof metadata.toolName === "string" ? metadata.toolName : message.title,
		toolCallId,
	);
	if (title) return false;
	if (Array.isArray(metadata.locations) && metadata.locations.length > 0) return false;
	if (metadata.inputJson !== undefined && metadata.inputJson !== null) return false;
	if (metadata.outputBlocks?.some((block) => block.type === "diff")) return false;

	const text = normalizeRuntimeLogText(
		[
			message.content,
			rawRuntimeLogText(metadata.outputResult),
			rawRuntimeLogText(metadata.outputJson),
			metadata.outputBlocks
				?.map((block) => blockText(block))
				.filter(Boolean)
				.join("\n"),
		]
			.filter(Boolean)
			.join("\n"),
	);
	return isRuntimeLogText(text);
};

const displayACPToolTitle = (title: string | undefined, toolCallId: string) => {
	const trimmed = title?.trim();
	if (
		!trimmed ||
		trimmed === toolCallId ||
		defaultToolTitles.has(trimmed) ||
		/^\d{4}-\d{2}-\d{2}T\d{2}/.test(trimmed)
	) {
		return undefined;
	}
	return trimmed;
};

const rawRuntimeLogText = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map(rawRuntimeLogText).filter(Boolean).join("\n");
	}
	if (isRecord(value)) {
		const fields = [
			"formatted_output",
			"aggregated_output",
			"stdout",
			"stderr",
			"error",
			"message",
			"text",
		];
		const text = fields
			.map((field) => rawRuntimeLogText(value[field]))
			.filter(Boolean)
			.join("\n");
		return text || JSON.stringify(value, null, 2);
	}
	if (value === undefined || value === null) return "";
	return String(value);
};

const blockText = (block: { type: string; text?: string; terminalId?: string }) =>
	block.text ?? block.terminalId ?? "";

const normalizeRuntimeLogText = (text: string) =>
	stripAnsiEscapeSequences(text).toLowerCase().split(/\s+/).filter(Boolean).join(" ");

const isRuntimeLogText = (text: string) =>
	Boolean(text && runtimeLogMarkers.some((marker) => text.includes(marker)));

const stripAnsiEscapeSequences = (text: string) => {
	let output = "";
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) !== 27 || text[index + 1] !== "[") {
			output += text[index];
			continue;
		}
		index += 2;
		while (index < text.length) {
			const char = text[index];
			if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z")) break;
			index += 1;
		}
	}
	return output;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
