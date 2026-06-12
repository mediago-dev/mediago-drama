import type { AgentACPContentBlock } from "@/domains/agent/stores";

export type DiffLine =
	| { kind: "add" | "remove"; text: string }
	| { kind: "omitted"; count: number };

export const formatTime = (value?: string) => {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
};

export const compact = (value: string, limit = 120) =>
	value.trim().replace(/\s+/g, " ").slice(0, limit);

export const prettyJson = (value: unknown) => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

const escapeChar = String.fromCharCode(27);
const ansiEscapePattern = `${escapeChar}\\[[0-?]*[ -/]*[@-~]`;

export const hasAnsiEscape = (value: string) => new RegExp(ansiEscapePattern).test(value);

export const stripAnsiEscape = (value: string) =>
	value.replace(new RegExp(ansiEscapePattern, "g"), "");

export const cleanToolTitle = (title: string, toolCallId?: string) => {
	const trimmed = stripAnsiEscape(title).trim();
	if (!trimmed || trimmed === toolCallId?.trim() || /^\d{4}-\d{2}-\d{2}T\d{2}/.test(trimmed)) {
		return "";
	}
	return trimmed;
};

export const outputBlockPlainText = (block: AgentACPContentBlock) => {
	if (block.type === "diff") return [block.oldText, block.newText].filter(Boolean).join("\n");
	return block.text || block.terminalId || "";
};

export const byteLength = (value: string) => new TextEncoder().encode(value).length;

export const countTextLines = (value: string) => {
	if (!value) return 0;
	return value.split(/\r\n|\r|\n/).length;
};

export const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
};

export const formatDuration = (durationMs: number) => {
	if (durationMs < 1000) return `${durationMs} ms`;
	return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
};

export const isLargeText = (value: string) => countTextLines(value) > 6 || byteLength(value) > 2048;

export const compactDiffLines = (lines: DiffLine[]): DiffLine[] => {
	if (lines.length <= 200) return lines;
	return [
		...lines.slice(0, 100),
		{ kind: "omitted", count: lines.length - 150 },
		...lines.slice(-50),
	];
};
