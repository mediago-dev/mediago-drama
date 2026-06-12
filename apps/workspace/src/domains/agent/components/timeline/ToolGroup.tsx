import { ChevronRight, Wrench } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { compact, formatDuration } from "./format";
import { getToolCallDetails, ToolCallBody } from "./ToolCallCard";

type ToolCategory = "file" | "search" | "command" | "edit" | "fetch" | "call";

export const ToolGroup: React.FC<{ messages: AgentMessage[] }> = ({ messages }) => {
	const hasActive = useMemo(
		() => messages.some((message) => isActiveStatus(toolStatus(message))),
		[messages],
	);
	const [expanded, setExpanded] = useState(hasActive);
	const userToggledRef = useRef(false);
	const summary = useMemo(() => summarizeTools(messages), [messages]);
	const totalDurationMs = useMemo(() => sumDuration(messages), [messages]);
	const hasFailure = useMemo(
		() => messages.some((message) => toolStatus(message) === "failed"),
		[messages],
	);
	const Icon = useMemo(() => {
		const firstMessage = messages[0];
		return firstMessage ? getToolCallDetails(firstMessage).Icon : Wrench;
	}, [messages]);

	useEffect(() => {
		if (hasActive && !userToggledRef.current) {
			setExpanded(true);
		}
	}, [hasActive]);

	const toggleExpanded = () => {
		userToggledRef.current = true;
		setExpanded((value) => !value);
	};

	return (
		<section className="px-1 text-xs">
			<button
				type="button"
				className={cn(
					"flex w-full items-center justify-between gap-2 border-t border-border pt-2 text-left",
					hasFailure ? "text-error-foreground" : "text-muted-foreground",
				)}
				onClick={toggleExpanded}
				aria-expanded={expanded}
			>
				<span className="flex min-w-0 items-center gap-2">
					<Icon className="size-3.5 shrink-0" />
					<span className="truncate font-medium">{summary}</span>
				</span>
				<span className="flex shrink-0 items-center gap-1.5 text-caption">
					{totalDurationMs > 0 ? <span>{formatDuration(totalDurationMs)}</span> : null}
					<ChevronRight
						className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
					/>
				</span>
			</button>
			{expanded ? (
				<div className="mt-2 space-y-1 rounded-sm bg-ide-toolbar/50 px-2.5 py-2">
					{messages.map((message) => (
						<ToolGroupRow key={message.id} message={message} />
					))}
				</div>
			) : null}
		</section>
	);
};

const ToolGroupRow: React.FC<{ message: AgentMessage }> = ({ message }) => {
	const [expanded, setExpanded] = useState(false);
	const details = getToolCallDetails(message);
	const { Icon, title, acpKind, status } = details;
	const target = toolTarget(message);
	const hasFailure = status === "failed";

	return (
		<div className="border-b border-border/50 pb-1 last:border-0 last:pb-0">
			<button
				type="button"
				className="flex w-full items-center gap-2 py-1 text-left"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
			>
				<span
					className={cn(
						"flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-editor",
						rowIconTone(status),
					)}
				>
					<Icon className="size-3" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 items-center gap-1.5">
						<span
							className={cn(
								"truncate font-medium text-foreground",
								hasFailure && "text-error-foreground",
							)}
						>
							{title}
						</span>
						<span className="shrink-0 rounded-sm border border-border bg-ide-editor px-1.5 py-0.5 text-2xs text-muted-foreground">
							{acpKind}
						</span>
					</span>
					{target ? (
						<span className="mt-0.5 block truncate text-caption text-muted-foreground">
							{target}
						</span>
					) : null}
				</span>
				<span className="flex shrink-0 items-center gap-1.5">
					<RowStatus status={status} />
					<ChevronRight
						className={cn(
							"size-3.5 text-muted-foreground transition-transform",
							expanded && "rotate-90",
						)}
					/>
				</span>
			</button>
			{expanded ? (
				<ToolCallBody
					message={message}
					className="mt-1.5 overflow-hidden rounded-sm border border-border bg-ide-editor"
				/>
			) : null}
		</div>
	);
};

const RowStatus: React.FC<{ status?: string }> = ({ status }) => {
	if (!status) {
		return <span className="size-1.5 rounded-full bg-muted-foreground/60" title="unknown" />;
	}
	return (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs",
				statusTone(status),
			)}
			title={status}
		>
			<span className="size-1.5 rounded-full bg-current" />
			<span>{status}</span>
		</span>
	);
};

const summarizeTools = (messages: AgentMessage[]) => {
	if (messages.length === 1) return "1 项调用";

	const counts = new Map<ToolCategory, number>();
	for (const message of messages) {
		const category = categorize(message);
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}

	return categoryOrder
		.map((category) => {
			const count = counts.get(category) ?? 0;
			return count > 0 ? categoryLabel(category, count) : "";
		})
		.filter(Boolean)
		.join(" · ");
};

const categorize = (message: AgentMessage): ToolCategory => {
	const kind = message.kind ?? "tool";
	const { acpKind } = getToolCallDetails(message);
	if (acpKind === "read" || kind === "file") return "file";
	if (acpKind === "search") return "search";
	if (acpKind === "execute" || kind === "terminal") return "command";
	if (
		acpKind === "edit" ||
		acpKind === "delete" ||
		acpKind === "move" ||
		kind === "patch" ||
		kind === "diff"
	) {
		return "edit";
	}
	if (acpKind === "fetch") return "fetch";
	return "call";
};

const categoryOrder: ToolCategory[] = ["file", "search", "command", "edit", "fetch", "call"];

const categoryLabel = (category: ToolCategory, count: number) => {
	if (category === "file") return `已探索 ${count} 个文件`;
	if (category === "search") return `${count} 次搜索`;
	if (category === "command") return `${count} 条命令`;
	if (category === "edit") return `${count} 处编辑`;
	if (category === "fetch") return `${count} 次抓取`;
	return `${count} 次调用`;
};

const toolTarget = (message: AgentMessage) => {
	const metadata = message.metadata;
	const location = metadata?.locations?.[0];
	if (location) return location.line ? `${location.path}:${location.line}` : location.path;
	if (metadata?.filePath) return metadata.filePath;
	if (metadata?.inputArgs) return compact(firstLine(metadata.inputArgs));
	return "";
};

const firstLine = (value: string) => value.trim().split(/\r\n|\r|\n/)[0] ?? "";

const toolStatus = (message: AgentMessage) => getToolCallDetails(message).status;

const isActiveStatus = (status?: string) =>
	status === "pending" || status === "in_progress" || status === "streaming";

const sumDuration = (messages: AgentMessage[]) =>
	messages.reduce((total, message) => {
		const durationMs = message.metadata?.durationMs;
		return total + (typeof durationMs === "number" ? durationMs : 0);
	}, 0);

const statusTone = (status: string) => {
	if (status === "completed")
		return "border-success-border bg-success-surface text-success-foreground";
	if (status === "failed") return "border-error-border bg-error-surface text-error-foreground";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "border-warning-border bg-warning-surface text-warning-foreground";
	}
	return "border-info-border bg-info-surface text-info-foreground";
};

const rowIconTone = (status?: string) => {
	if (status === "completed") return "text-success-foreground";
	if (status === "failed") return "text-error-foreground";
	if (status === "in_progress" || status === "pending" || status === "streaming") {
		return "text-warning-foreground";
	}
	return "text-muted-foreground";
};
