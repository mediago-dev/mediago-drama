import {
	Brain,
	ChevronRight,
	FilePenLine,
	FileSearch,
	FileText,
	GitBranch,
	ImageIcon,
	LoaderCircle,
	Sparkles,
	TerminalSquare,
	UserRound,
} from "lucide-react";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import type React from "react";
import { memo, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import {
	type AgentA2UIActionHandler,
	handleDeterministicA2UIAction,
} from "@/domains/agent/lib/a2ui-actions";
import { agentPermissionRequestIdFromA2UI } from "@/domains/agent/lib/a2ui-permissions";
import {
	type AgentDisplayAttachment,
	type AgentMessage,
	type AgentMessageKind,
	type AgentMessageMetadata,
	type AgentRuntimeAlert,
	useAgentStore,
} from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { RuntimeAlertCard } from "./RuntimeAlertCard";
import { AgentA2UIMessage } from "./timeline/AgentA2UIMessage";
import { CodeBlock, DiffBlock, TerminalBlock } from "./timeline/CodeBlocks";
import { compact, formatTime } from "./timeline/format";
import { MarkdownContent } from "./timeline/MarkdownContent";
import { buildTimelineEntries, groupAssistantMessages } from "./timeline/model";
import { PlanBlock } from "./timeline/PlanBlock";
import { ThoughtBlock } from "./timeline/ThoughtBlock";
import { ToolCallCard } from "./timeline/ToolCallCard";
import { ToolGroup } from "./timeline/ToolGroup";

interface AgentTimelineProps {
	className?: string;
	messages: AgentMessage[];
	isRunning: boolean;
	runtimeAlerts?: AgentRuntimeAlert[];
	onA2UIAction?: AgentA2UIActionHandler;
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({
	className,
	messages,
	isRunning,
	runtimeAlerts = [],
	onA2UIAction,
}) => {
	const entries = useMemo(() => buildTimelineEntries(messages), [messages]);
	const hasStreamingMessage = messages.some((message) => message.status === "streaming");
	const items = useMemo<TimelineRenderItem[]>(() => {
		const timelineItems = entries.map((entry): TimelineRenderItem => ({ type: "entry", entry }));
		const alertItems = runtimeAlerts.map(
			(alert): TimelineRenderItem => ({ type: "runtime-alert", alert }),
		);
		if (!isRunning || hasStreamingMessage) return [...timelineItems, ...alertItems];

		return [...timelineItems, ...alertItems, { type: "running", id: "agent-running" }];
	}, [entries, hasStreamingMessage, isRunning, runtimeAlerts]);

	return (
		<Virtuoso
			className={cn("agent-timeline h-full", className)}
			data={items}
			alignToBottom
			computeItemKey={(_, item) => timelineRenderItemKey(item)}
			followOutput={(atBottom) => (atBottom ? "smooth" : false)}
			initialItemCount={Math.min(items.length, 20)}
			increaseViewportBy={{ top: 800, bottom: 800 }}
			itemContent={(index, item) => (
				<div className={cn("agent-timeline-row px-4 pb-3", index === 0 && "pt-4")}>
					{renderTimelineItem(item, onA2UIAction)}
				</div>
			)}
		/>
	);
};

type TimelineEntry = ReturnType<typeof buildTimelineEntries>[number];

type TimelineRenderItem =
	| { type: "entry"; entry: TimelineEntry }
	| { type: "runtime-alert"; alert: AgentRuntimeAlert }
	| { type: "running"; id: string };

const timelineRenderItemKey = (item: TimelineRenderItem) => {
	if (item.type === "entry") {
		return item.entry.type === "user" ? item.entry.message.id : item.entry.id;
	}
	if (item.type === "runtime-alert") return `runtime-alert:${item.alert.id}`;
	return item.id;
};

const renderTimelineItem = (item: TimelineRenderItem, onA2UIAction?: AgentA2UIActionHandler) => {
	if (item.type === "runtime-alert") return <RuntimeAlertCard alert={item.alert} />;
	if (item.type === "running") return <TimelineRunning />;

	return item.entry.type === "user" ? (
		<TimelineUserTurn message={item.entry.message} />
	) : (
		<TimelineAssistantGroup messages={item.entry.messages} onA2UIAction={onA2UIAction} />
	);
};

const TimelineUserTurn: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const legacyAttachments = legacyDisplayAttachments(message.content);
	const attachments = uniqueDisplayAttachments(
		message.metadata?.displayAttachments ?? legacyAttachments,
	);
	const content = visibleUserContent(message.content);
	return (
		<div className="flex justify-end">
			<div className="flex max-w-[var(--message-bubble-max-width)] flex-col items-end gap-1.5">
				{attachments.length > 0 ? <UserAttachmentStrip attachments={attachments} /> : null}
				<article className="agent-user-bubble rounded-lg bg-primary px-3 py-2 text-xs leading-5 text-primary-foreground">
					<div className="mb-1 flex items-center justify-end gap-1.5 text-caption opacity-80">
						<span>{formatTime(message.createdAt)}</span>
						<span>你</span>
						<UserRound className="size-3" />
					</div>
					<p className="whitespace-pre-wrap break-words">{content}</p>
				</article>
			</div>
		</div>
	);
});

const UserAttachmentStrip: React.FC<{ attachments: AgentDisplayAttachment[] }> = memo(
	({ attachments }) => (
		<div className="flex max-w-full flex-wrap justify-end gap-2">
			{attachments.map((attachment, index) => (
				<UserAttachmentCard
					key={attachment.id ?? `${attachment.name}-${index}`}
					attachment={attachment}
				/>
			))}
		</div>
	),
);

const UserAttachmentCard: React.FC<{ attachment: AgentDisplayAttachment }> = memo(
	({ attachment }) => {
		if (attachment.kind === "image" && attachment.url) {
			return (
				<a
					href={attachment.url}
					target="_blank"
					rel="noreferrer"
					className="agent-user-attachment block h-28 w-36 overflow-hidden rounded-sm border border-border bg-card shadow-sm transition-colors hover:border-primary"
					title={attachment.name}
				>
					<img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" />
				</a>
			);
		}

		return (
			<div
				className="agent-user-attachment grid max-w-64 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-2 text-left text-xs shadow-sm"
				title={attachment.name}
			>
				<span className="flex size-7 items-center justify-center rounded-sm bg-ide-toolbar text-muted-foreground">
					{attachment.kind === "image" ? (
						<ImageIcon className="size-4" />
					) : (
						<FileText className="size-4" />
					)}
				</span>
				<span className="min-w-0">
					<span className="block truncate font-medium text-foreground">{attachment.name}</span>
					<span className="mt-0.5 block truncate text-caption text-muted-foreground">
						{attachment.size !== undefined
							? formatAttachmentSize(attachment.size)
							: attachment.mimeType || "文件"}
					</span>
				</span>
			</div>
		);
	},
);

const formatAttachmentSize = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const uniqueDisplayAttachments = (attachments: AgentDisplayAttachment[]) => {
	const seen = new Set<string>();
	return attachments.filter((attachment) => {
		const key = displayAttachmentFingerprint(attachment);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

const displayAttachmentFingerprint = (attachment: AgentDisplayAttachment) =>
	[
		attachment.name.trim().toLowerCase(),
		displayAttachmentSizeKey(attachment.size),
		attachment.mimeType?.trim().toLowerCase() ?? "",
		normalizedDisplayAttachmentKind(attachment.kind),
	].join("\u0000");

const displayAttachmentSizeKey = (size?: number) =>
	size === undefined ? "" : formatAttachmentSize(size);

const normalizedDisplayAttachmentKind = (kind?: string) => {
	const normalized = kind?.trim().toLowerCase() ?? "";
	return normalized === "image" ? "image" : "file";
};

const visibleUserContent = (content: string) => {
	const markerIndex = firstLegacyAttachmentMarkerIndex(content);
	if (markerIndex < 0) return content;
	return content.slice(0, markerIndex).trim() || "已上传附件";
};

const legacyDisplayAttachments = (content: string): AgentDisplayAttachment[] => [
	...legacyInlineAttachments(content),
	...legacySavedAssetAttachments(content),
];

const firstLegacyAttachmentMarkerIndex = (content: string) => {
	const indexes = legacyAttachmentMarkers
		.map((marker) => content.indexOf(marker))
		.filter((index) => index >= 0);
	return indexes.length > 0 ? Math.min(...indexes) : -1;
};

const savedAssetAttachmentMarkers = ["已保存到资料的原始文件：", "已保存到素材库的原始文件："];
const legacyAttachmentMarkers = ["附件上下文：", ...savedAssetAttachmentMarkers];

const legacyInlineAttachments = (content: string): AgentDisplayAttachment[] => {
	const section = legacySection(content, "附件上下文：");
	if (!section) return [];

	const attachments: AgentDisplayAttachment[] = [];
	const headingPattern = /^(\d+)\.\s*(图片|文件)：(.+)$/gm;
	let match: RegExpExecArray | null;
	while ((match = headingPattern.exec(section)) !== null) {
		const start = match.index + match[0].length;
		const next = section.slice(start).search(/\n\d+\.\s*(?:图片|文件)：/);
		const block = next >= 0 ? section.slice(start, start + next) : section.slice(start);
		attachments.push({
			kind: match[2] === "图片" ? "image" : "file",
			mimeType: legacyLineValue(block, "MIME"),
			name: match[3].trim(),
			size: parseLegacySize(legacyLineValue(block, "大小")),
			url: legacyLineValue(block, "URL"),
		});
	}
	return attachments;
};

const legacySavedAssetAttachments = (content: string): AgentDisplayAttachment[] => {
	const attachments: AgentDisplayAttachment[] = [];
	for (const marker of savedAssetAttachmentMarkers) {
		const section = legacySection(content, marker);
		if (!section) continue;

		const headingPattern = /^(\d+)\.\s*(.+)$/gm;
		let match: RegExpExecArray | null;
		while ((match = headingPattern.exec(section)) !== null) {
			const start = match.index + match[0].length;
			const next = section.slice(start).search(/\n\d+\.\s*.+/);
			const block = next >= 0 ? section.slice(start, start + next) : section.slice(start);
			attachments.push({
				kind: legacyLineValue(block, "类型") || "file",
				mimeType: legacyLineValue(block, "MIME"),
				name: match[2].trim(),
				size: parseLegacySize(legacyLineValue(block, "大小")),
				url: legacyLineValue(block, "URL"),
			});
		}
	}
	return attachments;
};

const legacySection = (content: string, marker: string) => {
	const start = content.indexOf(marker);
	if (start < 0) return "";
	const afterMarker = content.slice(start + marker.length);
	const nextMarkerIndexes = legacyAttachmentMarkers
		.filter((item) => item !== marker)
		.map((item) => afterMarker.indexOf(item))
		.filter((index) => index >= 0);
	const end = nextMarkerIndexes.length > 0 ? Math.min(...nextMarkerIndexes) : afterMarker.length;
	return afterMarker.slice(0, end).trim();
};

const legacyLineValue = (block: string, label: string) => {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = block.match(new RegExp(`^${escaped}：\\s*(.+)$`, "m"));
	return match?.[1]?.trim() || undefined;
};

const parseLegacySize = (value?: string) => {
	if (!value) return undefined;
	const match = value.match(/^([\d.]+)\s*(bytes?|B|KB|MB|GB)$/i);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return undefined;
	const unit = match[2].toUpperCase();
	if (unit === "GB") return Math.round(amount * 1024 * 1024 * 1024);
	if (unit === "MB") return Math.round(amount * 1024 * 1024);
	if (unit === "KB") return Math.round(amount * 1024);
	return Math.round(amount);
};

const TimelineAssistantGroup: React.FC<{
	messages: AgentMessage[];
	onA2UIAction?: AgentA2UIActionHandler;
}> = memo(({ messages, onA2UIAction }) => {
	const items = useMemo(() => groupAssistantMessages(messages), [messages]);
	return (
		<div className="agent-assistant-group space-y-2 px-1">
			{items.map((item) =>
				item.type === "thoughts" ? (
					<ThoughtBlock key={item.id} messages={item.messages} />
				) : item.type === "tools" ? (
					<ToolGroup key={item.id} messages={item.messages} />
				) : (
					<TimelineAssistantItem
						key={item.message.id}
						message={item.message}
						onA2UIAction={onA2UIAction}
					/>
				),
			)}
		</div>
	);
});

const TimelineAssistantItem: React.FC<{
	message: AgentMessage;
	onA2UIAction?: AgentA2UIActionHandler;
}> = memo(({ message, onA2UIAction }) => {
	const kind = message.kind ?? "message";

	if (message.metadata?.a2ui) {
		return <TimelineA2UIItem message={message} onA2UIAction={onA2UIAction} />;
	}

	if (kind === "message") {
		return <TimelineMessage message={message} />;
	}
	if (kind === "tool" && isACPToolMessage(message)) {
		return <ToolCallCard message={message} />;
	}
	if (kind === "plan") {
		return (
			<TimelineAction message={message} defaultExpanded>
				<PlanBlock content={message.content} entries={message.metadata?.planEntries} />
			</TimelineAction>
		);
	}

	return (
		<TimelineAction message={message}>
			<ActionContent message={message} />
		</TimelineAction>
	);
});

const TimelineA2UIItem: React.FC<{
	message: AgentMessage;
	onA2UIAction?: AgentA2UIActionHandler;
}> = memo(({ message, onA2UIAction }) => {
	const permissionRequestId = agentPermissionRequestIdFromA2UI(message.metadata?.a2ui);
	if (permissionRequestId) return null;

	return (
		<AgentA2UIMessage
			message={message}
			onAction={(targetMessage, action) =>
				void handleA2UIAction(targetMessage, action, onA2UIAction)
			}
		/>
	);
});

const TimelineMessage: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const { thoughts, text } = splitAssistantInlineThoughts(message.content);
	return (
		<>
			{thoughts.map((thought, index) => (
				<ThoughtBlock
					key={`${message.id}-inline-thought-${index}`}
					messages={[
						{
							...message,
							id: `${message.id}-inline-thought-${index}`,
							content: thought,
							kind: "thought",
						},
					]}
				/>
			))}
			{text ? <AssistantTextMessage message={message} content={text} /> : null}
		</>
	);
});

const AssistantTextMessage: React.FC<{ message: AgentMessage; content: string }> = ({
	message,
	content,
}) => {
	const rich = isRichAssistantMarkdown(content);
	return (
		<article
			className={cn(
				"agent-assistant-message text-xs leading-5",
				rich
					? "agent-assistant-message-card px-3 py-3"
					: "agent-assistant-message-inline px-1 py-1",
				message.status === "error" ? "text-error-foreground" : "text-foreground",
			)}
		>
			{rich ? (
				<div className="agent-assistant-message-heading">
					<span className="agent-assistant-message-icon" aria-hidden="true">
						<Sparkles />
					</span>
					<span className="agent-assistant-message-title">文档智能体</span>
					<span className="agent-assistant-message-dot">·</span>
					<span className="agent-assistant-message-subtitle">最终回复</span>
				</div>
			) : (
				<span className="agent-assistant-inline-icon" aria-hidden="true">
					<Sparkles />
				</span>
			)}
			<div className="agent-assistant-message-content">
				<MarkdownContent content={content} />
				{message.status === "streaming" ? <StreamingCursor /> : null}
			</div>
		</article>
	);
};

const TimelineAction: React.FC<{
	message: AgentMessage;
	defaultExpanded?: boolean;
	children: React.ReactNode;
}> = memo(({ message, defaultExpanded = false, children }) => {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const kind = message.kind ?? "tool";
	const Icon = iconByKind[kind] ?? TerminalSquare;
	const title = actionTitle(message);
	const summary = actionSummary(message);
	const hasSummary = Boolean(summary);
	const isError = message.status === "error";

	return (
		<article className={cn("agent-action-card text-xs", kind === "plan" && "agent-plan-card")}>
			<div className="flex items-start gap-2 px-2.5 py-2">
				<span
					className={cn(
						"agent-action-icon mt-1 flex shrink-0 items-center gap-1",
						actionIconTone(message),
					)}
				>
					<Icon className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<button
						type="button"
						className={cn(
							"agent-action-toggle flex w-full justify-between gap-2 text-left",
							hasSummary ? "items-start" : "items-center",
						)}
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
					>
						<span className="min-w-0">
							<span
								className={cn(
									"block truncate font-medium text-foreground",
									kind === "thought" && "italic text-muted-foreground",
									isError && "text-error-foreground",
								)}
							>
								{title}
							</span>
							{kind === "plan" ? (
								<PlanProgressBadge entries={message.metadata?.planEntries} />
							) : null}
							{hasSummary ? (
								<span
									className={cn(
										"mt-0.5 block truncate text-caption text-muted-foreground",
										kind === "thought" && "italic",
									)}
								>
									{summary}
								</span>
							) : null}
						</span>
						<span className="agent-action-meta flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
							{formatTime(message.createdAt)}
							<ChevronRight
								className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
							/>
						</span>
					</button>
					{expanded ? (
						<div
							className={cn(
								"agent-action-body mt-1.5 space-y-2 rounded-sm bg-ide-toolbar/50 px-2.5 py-2 leading-5 text-muted-foreground",
								kind === "thought" && "italic",
							)}
						>
							{children}
							{message.status === "streaming" ? <StreamingCursor /> : null}
						</div>
					) : null}
				</div>
			</div>
		</article>
	);
});

const isRichAssistantMarkdown = (content: string) => {
	const trimmed = content.trim();
	if (!trimmed) return false;
	if (trimmed.length > 120) return true;
	return /(^|\n)(#{1,6}\s|[-*]\s|\d+[.)]\s|>\s|```)/.test(trimmed);
};

const splitAssistantInlineThoughts = (content: string) => {
	const thoughts: string[] = [];
	const textSegments: string[] = [];
	const openPattern = /<think>/gi;
	let cursor = 0;
	let openMatch: RegExpExecArray | null;

	while ((openMatch = openPattern.exec(content)) !== null) {
		if (openMatch.index > cursor) {
			textSegments.push(content.slice(cursor, openMatch.index));
		}

		const start = openPattern.lastIndex;
		const closePattern = /<\/think>/gi;
		closePattern.lastIndex = start;
		const closeMatch = closePattern.exec(content);
		if (!closeMatch) {
			const thought = content.slice(start).trim();
			if (thought) thoughts.push(thought);
			cursor = content.length;
			break;
		}

		const thought = content.slice(start, closeMatch.index).trim();
		if (thought) thoughts.push(thought);
		cursor = closeMatch.index + closeMatch[0].length;
		openPattern.lastIndex = cursor;
	}

	if (cursor < content.length) textSegments.push(content.slice(cursor));

	return {
		thoughts,
		text: textSegments
			.map((segment) => segment.trim())
			.filter(Boolean)
			.join("\n\n"),
	};
};

const PlanProgressBadge: React.FC<{ entries?: AgentMessageMetadata["planEntries"] }> = ({
	entries,
}) => {
	if (!entries || entries.length === 0) return null;
	const completed = entries.filter((entry) => entry.status === "completed").length;
	return (
		<span className="agent-plan-progress">
			{completed} / {entries.length} 完成
		</span>
	);
};

const ActionContent: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const kind = message.kind ?? "tool";
	const metadata = message.metadata;

	if (kind === "tool") {
		return (
			<div className="space-y-2">
				{metadata?.inputArgs ? <LabeledCode label="输入" content={metadata.inputArgs} /> : null}
				{metadata?.outputResult ? (
					<LabeledCode label="输出" content={metadata.outputResult} />
				) : null}
				{!metadata?.inputArgs && !metadata?.outputResult ? (
					<p className="whitespace-pre-wrap break-words">{message.content}</p>
				) : null}
			</div>
		);
	}
	if (kind === "file") {
		return (
			<div className="space-y-2">
				{metadata?.filePath ? (
					<p className="font-mono text-caption text-info-foreground">
						{metadata.filePath}
						{metadata.lineRange ? `:${metadata.lineRange[0]}-${metadata.lineRange[1]}` : ""}
					</p>
				) : null}
				<p className="whitespace-pre-wrap break-words">
					{metadata?.outputResult ?? message.content}
				</p>
			</div>
		);
	}
	if (kind === "patch") {
		return <CodeBlock content={metadata?.outputResult ?? message.content} />;
	}
	if (kind === "diff" && metadata?.outputBlocks?.[0]) {
		return <DiffBlock block={metadata.outputBlocks[0]} />;
	}
	if (kind === "terminal" && metadata?.outputBlocks?.[0]) {
		return <TerminalBlock block={metadata.outputBlocks[0]} />;
	}
	if (kind === "runtime" && metadata?.runtimeLog === true) {
		const firstBlock = metadata.outputBlocks?.[0];
		if (firstBlock?.type === "terminal") return <TerminalBlock block={firstBlock} />;
		if (firstBlock?.text) return <CodeBlock content={firstBlock.text} />;
		if (metadata.outputResult) return <CodeBlock content={metadata.outputResult} />;
	}
	return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
});

const LabeledCode: React.FC<{ label: string; content: string }> = ({ label, content }) => (
	<div className="space-y-1">
		<p className="text-caption font-medium text-muted-foreground">{label}</p>
		<CodeBlock content={content} />
	</div>
);

const TimelineRunning: React.FC = () => (
	<div className="agent-running-indicator flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
		<LoaderCircle className="size-3.5 animate-spin text-primary" />
		<span>智能体正在处理</span>
		<StreamingCursor />
	</div>
);

const StreamingCursor: React.FC = () => (
	<span className="ml-1 inline-block h-3 w-1 animate-pulse bg-current align-[var(--inline-caret-align-offset)]" />
);

const actionTitle = (message: AgentMessage) => {
	const kind = message.kind ?? "tool";
	if (message.metadata?.toolName) return message.metadata.toolName;
	if (message.metadata?.filePath) return message.metadata.filePath;
	return message.title || actionLabelByKind[kind] || "智能体动作";
};

const actionSummary = (message: AgentMessage) => {
	const metadata = message.metadata;
	if ((message.kind ?? "tool") === "runtime" && metadata?.runtimeLog === true) return "";
	if (metadata?.lineRange) return `lines ${metadata.lineRange[0]}-${metadata.lineRange[1]}`;
	if (metadata?.outputResult) return compact(metadata.outputResult);
	return compact(message.content);
};

const isACPToolMessage = (message: AgentMessage) =>
	typeof message.metadata?.toolCallId === "string" && message.metadata.toolCallId.trim() !== "";

const iconByKind: Partial<Record<AgentMessageKind, React.ComponentType<{ className?: string }>>> = {
	diff: FilePenLine,
	file: FileSearch,
	patch: FilePenLine,
	plan: GitBranch,
	runtime: TerminalSquare,
	terminal: TerminalSquare,
	thought: Brain,
	tool: TerminalSquare,
};

const actionLabelByKind: Partial<Record<AgentMessageKind, string>> = {
	diff: "Diff",
	file: "文件",
	patch: "文档操作",
	plan: "计划",
	runtime: "运行日志",
	terminal: "终端",
	thought: "思考",
	tool: "工具调用",
};

const actionIconTone = (message: AgentMessage) => {
	const kind = message.kind ?? "tool";
	if (message.status === "error") return "text-error-foreground";
	if (kind === "thought") return "text-warning-foreground";
	if (kind === "file") return "text-info-foreground";
	if (kind === "patch" || kind === "diff") return "text-success-foreground";
	return "text-muted-foreground";
};

const handleA2UIAction = async (
	message: AgentMessage,
	action: A2uiClientAction,
	onA2UIAction?: AgentA2UIActionHandler,
) => {
	const keepsResultInTimeline = shouldKeepA2UIResultInTimeline(action);
	const dismissesBeforeHandling = shouldDismissA2UIOnAction(action) && !keepsResultInTimeline;
	if (dismissesBeforeHandling) {
		useAgentStore.getState().removeMessage(message.id);
	}

	const localHandled = await onA2UIAction?.(message, action);
	if (localHandled === true) {
		if (!dismissesBeforeHandling && !keepsResultInTimeline) {
			useAgentStore.getState().removeMessage(message.id);
		}
		return;
	}

	const deterministicHandled = await handleDeterministicA2UIAction(message, action);
	if (deterministicHandled) {
		if (!dismissesBeforeHandling && !keepsResultInTimeline) {
			useAgentStore.getState().removeMessage(message.id);
		}
		return;
	}

	const actionName = action.name.trim() || "action";
	useAgentStore.getState().removeMessage(message.id);
	void runAgentPrompt(formatA2UIActionPrompt(message, action), {
		displayPrompt: `执行界面操作：${actionName}`,
	});
};

const shouldDismissA2UIOnAction = (action: A2uiClientAction) => {
	const kind = action.context?.kind;
	return kind === "agent_permission" || kind === "document_tool_approval";
};

const shouldKeepA2UIResultInTimeline = (action: A2uiClientAction) =>
	action.context?.kind === "agent_permission";

const formatA2UIActionPrompt = (message: AgentMessage, action: A2uiClientAction) =>
	[
		"用户在 Agent 生成的 A2UI 界面中执行了操作。",
		"",
		`A2UI message id: ${message.id}`,
		"",
		"Action payload:",
		"```json",
		JSON.stringify(
			{
				name: action.name,
				surfaceId: action.surfaceId,
				sourceComponentId: action.sourceComponentId,
				timestamp: action.timestamp,
				context: action.context,
			},
			null,
			2,
		),
		"```",
	].join("\n");
