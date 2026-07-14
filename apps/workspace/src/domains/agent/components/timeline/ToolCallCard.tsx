import {
	Brain,
	ChevronRight,
	FileSearch,
	Globe,
	MoveRight,
	Pencil,
	Search,
	TerminalSquare,
	Trash2,
	Wrench,
} from "lucide-react";
import type React from "react";
import { memo, useMemo, useState } from "react";
import {
	type AgentACPContentBlock,
	type AgentMessage,
	type AgentMessageMetadata,
} from "@/domains/agent/stores";
import { inferToolKind } from "@/domains/agent/lib/tool-kind";
import { cn } from "@/shared/lib/utils";
import { DiffBlock, JsonViewBlock, TextOutputBlock } from "./CodeBlocks";
import {
	byteLength,
	cleanToolTitle,
	countTextLines,
	formatBytes,
	formatDuration,
	formatTime,
	hasAnsiEscape,
	outputBlockPlainText,
	prettyJson,
	stripAnsiEscape,
} from "./format";

interface ToolCallDetails {
	metadata: AgentMessageMetadata;
	title: string;
	acpKind: string;
	Icon: React.ComponentType<{ className?: string }>;
	status?: string;
	inputText?: string;
	inputValue?: unknown;
	outputBlocks: AgentACPContentBlock[];
	rawOutputValue?: unknown;
	outputBytes: number;
	outputLines: number;
	inputSummary: string;
	outputSummary: string;
	isMCP: boolean;
}

export const ToolCallCard: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const [expanded, setExpanded] = useState(false);
	const details = useMemo(() => getToolCallDetails(message), [message]);
	const { metadata, title, acpKind, Icon, status, inputSummary, outputSummary, isMCP } = details;

	return (
		<article className="agent-tool-card border border-border bg-ide-editor text-xs">
			<button
				type="button"
				className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
			>
				<span
					className={cn(
						"agent-tool-icon mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar",
						toolIconTone(status),
					)}
				>
					<Icon className="size-3.5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span className="truncate font-medium text-foreground">{title}</span>
						<span className="agent-chip shrink-0 rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs text-muted-foreground">
							{acpKind}
						</span>
						{isMCP ? (
							<span className="agent-chip agent-chip-info shrink-0 rounded-sm border border-info-border bg-info-surface px-1.5 py-0.5 text-2xs text-info-foreground">
								MCP
							</span>
						) : null}
						<StatusBadge status={status} />
					</span>
					<span className="mt-1 block truncate text-caption text-muted-foreground">
						{[
							metadata.durationMs ? formatDuration(metadata.durationMs) : "",
							inputSummary,
							outputSummary,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
					{formatTime(message.createdAt)}
					<ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
				</span>
			</button>
			{expanded ? (
				<ToolCallBody message={message} className="border-t border-border px-3 py-2" />
			) : null}
		</article>
	);
});

export const ToolCallBody: React.FC<{
	message: AgentMessage;
	className?: string;
}> = memo(({ message, className }) => {
	const details = useMemo(() => getToolCallDetails(message), [message]);
	const { metadata, acpKind, inputText, inputValue, outputBlocks, rawOutputValue } = details;
	const hasInput = inputValue !== undefined || Boolean(inputText);
	const hasLocations = Boolean(metadata.locations?.length);

	return (
		<div className={cn("agent-tool-body min-w-0 space-y-2", className)}>
			<ToolOutputPanel acpKind={acpKind} blocks={outputBlocks} message={message} />
			{hasInput || hasLocations || rawOutputValue !== undefined ? (
				<div className="agent-tool-secondary-details flex flex-wrap items-start gap-x-3 gap-y-1">
					{hasInput ? (
						<CompactToolDetails label="输入">
							{inputValue !== undefined ? (
								<JsonViewBlock label="输入数据" value={inputValue} />
							) : inputText ? (
								<TextOutputBlock label="输入文本" text={inputText} />
							) : null}
						</CompactToolDetails>
					) : null}
					{hasLocations ? (
						<CompactToolDetails label="位置">
							<ToolLocationsPanel locations={metadata.locations ?? []} />
						</CompactToolDetails>
					) : null}
					{rawOutputValue !== undefined ? (
						<CompactToolDetails label="原始结果">
							<JsonViewBlock label="原始结果" value={rawOutputValue} />
						</CompactToolDetails>
					) : null}
				</div>
			) : null}
		</div>
	);
});

export const getToolCallDetails = (message: AgentMessage): ToolCallDetails => {
	const metadata: AgentMessageMetadata = message.metadata ?? {};
	const title =
		cleanToolTitle(metadata.toolName || "", metadata.toolCallId) ||
		cleanToolTitle(message.title || "", metadata.toolCallId) ||
		"工具调用";
	const acpKind = getAcpKind(message, metadata, title);
	const Icon = acpIconByKind[acpKind] ?? Wrench;
	const status =
		typeof metadata.status === "string"
			? metadata.status
			: message.status === "error"
				? "failed"
				: message.status === "streaming"
					? "streaming"
					: undefined;
	const inputValue = metadata.inputJson;
	const inputText = metadata.inputJson === undefined ? (metadata.inputArgs ?? "") : undefined;
	const protocolOutputBlocks = metadata.outputBlocks ?? [];
	const rawOutputValue =
		metadata.outputJson === undefined ? metadata.outputResult : metadata.outputJson;
	const protocolHasText = protocolOutputBlocks.some((block) => {
		if (block.type === "diff") return Boolean(block.oldText || block.newText);
		const text = block.text?.trim();
		return Boolean(text && text !== block.terminalId?.trim());
	});
	const rawOutputBlock = contentBlockFromRawOutput(rawOutputValue, acpKind);
	const outputBlocks = protocolHasText
		? protocolOutputBlocks
		: rawOutputBlock
			? [rawOutputBlock]
			: protocolOutputBlocks;
	const rawOutputJsonText =
		metadata.outputJson === undefined ? "" : prettyJson(metadata.outputJson);
	const outputText = [outputBlocks.map(outputBlockPlainText).join("\n"), rawOutputJsonText]
		.filter(Boolean)
		.join("\n");
	const outputBytes = typeof metadata.bytes === "number" ? metadata.bytes : byteLength(outputText);
	const outputLines =
		typeof metadata.lines === "number" ? metadata.lines : countTextLines(outputText);
	const inputBytes =
		inputValue === undefined ? byteLength(inputText ?? "") : byteLength(prettyJson(inputValue));
	const inputSummary = inputBytes > 0 ? `${formatBytes(inputBytes)} in` : "0 B in";
	const outputSummary =
		outputBytes > 0 ? `${outputLines} lines / ${formatBytes(outputBytes)} out` : "0 B out";
	const isMCP = /^mcp__/i.test(title);

	return {
		metadata,
		title,
		acpKind,
		Icon,
		status,
		inputText,
		inputValue,
		outputBlocks,
		rawOutputValue: metadata.outputJson === undefined ? undefined : metadata.outputJson,
		outputBytes,
		outputLines,
		inputSummary,
		outputSummary,
		isMCP,
	};
};

const ToolOutputPanel: React.FC<{
	acpKind: string;
	blocks: AgentACPContentBlock[];
	message: AgentMessage;
}> = ({ acpKind, blocks, message }) => {
	if (blocks.length === 0) {
		return <EmptyToolPanel>{message.content || "暂无输出"}</EmptyToolPanel>;
	}

	return (
		<section className="agent-tool-output min-w-0 space-y-1.5">
			<p className="text-caption font-medium text-muted-foreground">输出</p>
			{blocks.map((block, index) => {
				if (block.type === "diff") {
					return <DiffBlock key={`${block.type}-${index}`} block={block} />;
				}
				const rawText = outputBlockPlainText(block);
				const parsedJsonText = parseJsonTextBlock(rawText);
				const text =
					parsedJsonText !== undefined
						? prettyJson(parsedJsonText)
						: acpKind === "execute" || hasAnsiEscape(rawText)
							? stripAnsiEscape(rawText)
							: rawText;
				if (!text) return null;
				return (
					<div key={`${block.type}-${index}`} className="agent-tool-output-block min-w-0">
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-ide-toolbar/65 px-2.5 py-2 font-mono text-caption leading-5 text-foreground">
							<code>{text}</code>
						</pre>
						{block.exitCode !== undefined ? (
							<p className="mt-1 text-2xs text-muted-foreground">退出码 {block.exitCode}</p>
						) : null}
					</div>
				);
			})}
		</section>
	);
};

const CompactToolDetails: React.FC<{
	label: string;
	children: React.ReactNode;
}> = ({ label, children }) => (
	<details className="agent-tool-detail group min-w-0 text-caption text-muted-foreground">
		<summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
			<ChevronRight
				className="size-3 transition-transform group-open:rotate-90"
				aria-hidden="true"
			/>
			<span>{label}</span>
		</summary>
		<div className="mt-1 min-w-0">{children}</div>
	</details>
);

const contentBlockFromRawOutput = (
	rawOutput: unknown,
	acpKind: string,
): AgentACPContentBlock | undefined => {
	if (rawOutput === undefined || rawOutput === null) return undefined;
	if (typeof rawOutput === "string") {
		return rawOutput
			? {
					type: acpKind === "execute" || hasAnsiEscape(rawOutput) ? "terminal" : "text",
					text: rawOutput,
				}
			: undefined;
	}
	if (!isRecord(rawOutput)) return { type: "text", text: prettyJson(rawOutput) };

	const text = [
		stringField(rawOutput, "formatted_output"),
		stringField(rawOutput, "aggregated_output"),
		stringField(rawOutput, "stdout"),
		stringField(rawOutput, "stderr"),
		stringField(rawOutput, "error"),
		stringField(rawOutput, "message"),
	]
		.filter(Boolean)
		.find((value) => value.trim() !== "");
	if (!text) return { type: "text", text: prettyJson(rawOutput) };

	const exitCode = numberField(rawOutput, "exit_code");
	const isTerminalOutput =
		acpKind === "execute" ||
		rawOutput.command !== undefined ||
		exitCode !== undefined ||
		hasAnsiEscape(text);
	return {
		type: isTerminalOutput ? "terminal" : "text",
		text,
		exitCode,
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: Record<string, unknown>, key: string) =>
	typeof value[key] === "string" ? value[key] : "";

const numberField = (value: Record<string, unknown>, key: string) =>
	typeof value[key] === "number" ? value[key] : undefined;

const parseJsonTextBlock = (text?: string) => {
	const trimmed = text?.trim();
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed === "object" && parsed !== null) return parsed;
	} catch {
		return undefined;
	}
	return undefined;
};

const ToolLocationsPanel: React.FC<{ locations: AgentMessageMetadata["locations"] }> = ({
	locations,
}) => {
	if (!locations || locations.length === 0) return <EmptyToolPanel>暂无位置</EmptyToolPanel>;

	return (
		<ul className="space-y-1 text-caption text-muted-foreground">
			{locations.map((location, index) => (
				<li key={`${location.path}-${location.line ?? "file"}-${index}`} className="font-mono">
					{location.path}
					{location.line ? `:${location.line}` : ""}
				</li>
			))}
		</ul>
	);
};

const EmptyToolPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<p className="text-caption text-muted-foreground">{children}</p>
);

export const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
	if (!status) return null;
	return (
		<span
			className={cn(
				"agent-tool-status shrink-0 rounded-sm border px-1.5 py-0.5 text-2xs",
				statusTone(status),
			)}
		>
			<span className="agent-tool-status-dot" aria-hidden="true" />
			{toolStatusLabel(status)}
		</span>
	);
};

const acpIconByKind: Record<string, React.ComponentType<{ className?: string }>> = {
	delete: Trash2,
	edit: Pencil,
	execute: TerminalSquare,
	fetch: Globe,
	move: MoveRight,
	other: Wrench,
	read: FileSearch,
	search: Search,
	think: Brain,
};

const defaultAcpKindByMessageKind: Partial<Record<NonNullable<AgentMessage["kind"]>, string>> = {
	diff: "edit",
	file: "read",
	patch: "edit",
	terminal: "execute",
};

const getAcpKind = (message: AgentMessage, metadata: AgentMessageMetadata, title: string) => {
	const inferred = inferToolKind(title);
	if (typeof metadata.acpKind === "string") {
		const explicit = metadata.acpKind.trim();
		if (explicit && explicit !== "other") return explicit;
		if (inferred) return inferred;
		if (explicit) return explicit;
	}
	return inferred || defaultAcpKindByMessageKind[message.kind ?? "tool"] || "other";
};

const statusTone = (status: string) => {
	if (status === "completed")
		return "border-success-border bg-success-surface text-success-foreground";
	if (status === "failed") return "border-error-border bg-error-surface text-error-foreground";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "border-warning-border bg-warning-surface text-warning-foreground";
	}
	return "border-info-border bg-info-surface text-info-foreground";
};

const toolStatusLabel = (status: string) => {
	if (status === "completed") return "完成";
	if (status === "failed") return "失败";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "运行中";
	}
	return status;
};

const toolIconTone = (status?: string) => {
	if (status === "completed") return "text-success-foreground";
	if (status === "failed") return "text-error-foreground";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "text-warning-foreground";
	}
	return "text-muted-foreground";
};
