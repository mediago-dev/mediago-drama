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
import { DiffBlock, JsonViewBlock, TerminalBlock, TextOutputBlock } from "./CodeBlocks";
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
} from "./format";

type ToolCallTab = "input" | "output" | "locations";

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
	const [activeTab, setActiveTab] = useState<ToolCallTab>("output");
	const details = useMemo(() => getToolCallDetails(message), [message]);
	const { metadata, title, acpKind, Icon, status, inputSummary, outputSummary, isMCP } = details;

	return (
		<article className="border border-border bg-ide-editor text-xs">
			<button
				type="button"
				className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
			>
				<span
					className={cn(
						"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar",
						toolIconTone(status),
					)}
				>
					<Icon className="size-3.5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span className="truncate font-medium text-foreground">{title}</span>
						<span className="shrink-0 rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs text-muted-foreground">
							{acpKind}
						</span>
						{isMCP ? (
							<span className="shrink-0 rounded-sm border border-info-border bg-info-surface px-1.5 py-0.5 text-2xs text-info-foreground">
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
				<ToolCallBody message={message} activeTab={activeTab} onTabChange={setActiveTab} />
			) : null}
		</article>
	);
});

export const ToolCallBody: React.FC<{
	message: AgentMessage;
	activeTab?: ToolCallTab;
	onTabChange?: (tab: ToolCallTab) => void;
	className?: string;
}> = memo(({ message, activeTab, onTabChange, className }) => {
	const [internalActiveTab, setInternalActiveTab] = useState<ToolCallTab>("output");
	const currentTab = activeTab ?? internalActiveTab;
	const setTab = (tab: ToolCallTab) => {
		if (onTabChange) {
			onTabChange(tab);
			return;
		}
		setInternalActiveTab(tab);
	};
	const details = useMemo(() => getToolCallDetails(message), [message]);
	const { metadata, acpKind, inputText, inputValue, outputBlocks, rawOutputValue } = details;

	return (
		<div className={cn("border-t border-border bg-ide-toolbar/45", className)}>
			<div className="flex border-b border-border">
				<ToolTabButton active={currentTab === "input"} onClick={() => setTab("input")}>
					输入
				</ToolTabButton>
				<ToolTabButton active={currentTab === "output"} onClick={() => setTab("output")}>
					输出
				</ToolTabButton>
				<ToolTabButton active={currentTab === "locations"} onClick={() => setTab("locations")}>
					位置
				</ToolTabButton>
			</div>
			<div className="space-y-2 px-2.5 py-2">
				{currentTab === "input" ? (
					inputValue !== undefined ? (
						<JsonViewBlock label="rawInput" value={inputValue} />
					) : inputText ? (
						<TextOutputBlock label="rawInput" text={inputText} />
					) : (
						<EmptyToolPanel>暂无输入</EmptyToolPanel>
					)
				) : null}
				{currentTab === "output" ? (
					<ToolOutputPanel
						acpKind={acpKind}
						blocks={outputBlocks}
						rawOutputValue={rawOutputValue}
						message={message}
					/>
				) : null}
				{currentTab === "locations" ? (
					<ToolLocationsPanel locations={metadata.locations ?? []} />
				) : null}
			</div>
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
	const rawOutputBlock =
		protocolOutputBlocks.length === 0
			? contentBlockFromRawOutput(rawOutputValue, acpKind)
			: undefined;
	const outputBlocks = rawOutputBlock ? [rawOutputBlock] : protocolOutputBlocks;
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

const ToolTabButton: React.FC<{
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}> = ({ active, onClick, children }) => (
	<button
		type="button"
		className={cn(
			"border-r border-border px-2.5 py-1.5 text-caption transition-colors",
			active ? "bg-ide-editor text-foreground" : "text-muted-foreground hover:bg-ide-editor",
		)}
		onClick={onClick}
	>
		{children}
	</button>
);

const ToolOutputPanel: React.FC<{
	acpKind: string;
	blocks: AgentACPContentBlock[];
	rawOutputValue?: unknown;
	message: AgentMessage;
}> = ({ acpKind, blocks, rawOutputValue, message }) => {
	if (blocks.length === 0 && rawOutputValue === undefined) {
		return <EmptyToolPanel>{message.content || "暂无输出"}</EmptyToolPanel>;
	}

	return (
		<div className="space-y-2">
			{blocks.map((block, index) => {
				if (block.type === "diff") {
					return <DiffBlock key={`${block.type}-${index}`} block={block} />;
				}
				if (block.type === "terminal") {
					return <TerminalBlock key={`${block.type}-${index}`} block={block} />;
				}
				if (acpKind === "execute" || hasAnsiEscape(block.text ?? "")) {
					return (
						<TerminalBlock
							key={`${block.type}-${index}`}
							block={{ ...block, type: "terminal", text: block.text ?? "" }}
						/>
					);
				}
				const parsedJsonText = parseJsonTextBlock(block.text);
				if (parsedJsonText !== undefined) {
					return (
						<JsonViewBlock
							key={`${block.type}-${index}`}
							label={block.type || "text JSON"}
							value={parsedJsonText}
						/>
					);
				}
				return (
					<TextOutputBlock
						key={`${block.type}-${index}`}
						label={block.type || "text"}
						text={block.text ?? ""}
					/>
				);
			})}
			{rawOutputValue !== undefined ? (
				<JsonViewBlock label="rawOutput JSON" value={rawOutputValue} />
			) : null}
		</div>
	);
};

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
		<span className={cn("shrink-0 rounded-sm border px-1.5 py-0.5 text-2xs", statusTone(status))}>
			{status}
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

const toolIconTone = (status?: string) => {
	if (status === "completed") return "text-success-foreground";
	if (status === "failed") return "text-error-foreground";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "text-warning-foreground";
	}
	return "text-muted-foreground";
};
