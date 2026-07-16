import {
	Brain,
	ChevronRight,
	FilePenLine,
	FileSearch,
	FileText,
	GitBranch,
	ImageIcon,
	LoaderCircle,
	TerminalSquare,
	UserRound,
} from "lucide-react";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import type React from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import {
	type AgentA2UIActionHandler,
	handleDeterministicA2UIAction,
} from "@/domains/agent/lib/a2ui-actions";
import { agentPermissionRequestIdFromA2UI } from "@/domains/agent/lib/a2ui-permissions";
import { displaySegmentsFromMetadata } from "@/domains/agent/lib/display-segments";
import {
	legacyDisplayAttachments,
	visibleUserContent,
} from "@/domains/agent/lib/legacy-attachments";
import {
	type AgentDisplayAttachment,
	type AgentDisplaySegment,
	type AgentConversationStatus,
	type AgentMessage,
	type AgentMessageKind,
	type AgentMessageMetadata,
	type AgentRuntimeAlert,
	selectAgentActiveConversation,
	selectAgentSessionId,
	useAgentStore,
} from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap-mention.css";
import { RuntimeAlertCard } from "./RuntimeAlertCard";
import { AgentA2UIMessage } from "./timeline/AgentA2UIMessage";
import { AgentFormCard } from "./timeline/AgentFormCard";
import { CodeBlock, DiffBlock, TerminalBlock } from "./timeline/CodeBlocks";
import { compact, formatTime } from "./timeline/format";
import { MarkdownContent } from "./timeline/MarkdownContent";
import {
	buildAgentTurnViewModels,
	type AgentTurnProjectionState,
	groupAssistantMessages,
	type AgentTurnViewModel,
} from "./timeline/model";
import { PlanBlock } from "./timeline/PlanBlock";
import { ProcessDisclosure, type ProcessDisclosureOverride } from "./timeline/ProcessDisclosure";
import { readableThoughtContent } from "./timeline/ThoughtBlock";
import { ToolGroup } from "./timeline/ToolGroup";

interface AgentTimelineProps {
	className?: string;
	messages: AgentMessage[];
	isRunning: boolean;
	isHydrating?: boolean;
	runtimeAlerts?: AgentRuntimeAlert[];
	onA2UIAction?: AgentA2UIActionHandler;
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({
	className,
	messages,
	isRunning,
	isHydrating = false,
	runtimeAlerts = [],
	onA2UIAction,
}) => {
	const now = useAgentElapsedClock(isRunning);
	const activeConversation = useAgentStore(selectAgentActiveConversation);
	const sessionId = useAgentStore(selectAgentSessionId);
	const pendingPermissionCount = useAgentStore((state) => state.permissionRequests.length);
	const activeTurn = useMemo(
		() =>
			turnProjectionFromConversation(
				activeConversation?.status,
				isRunning,
				pendingPermissionCount > 0,
				activeConversation?.createdAt,
				activeConversation?.updatedAt,
			),
		[
			activeConversation?.createdAt,
			activeConversation?.status,
			activeConversation?.updatedAt,
			isRunning,
			pendingPermissionCount,
		],
	);
	const turns = useMemo(
		() =>
			buildAgentTurnViewModels(messages, {
				activeTurnId: activeConversation?.runId,
				activeTurn,
				now,
			}),
		[activeConversation?.runId, activeTurn, messages, now],
	);
	const [disclosureOverrides, setDisclosureOverrides] = useState<
		Record<string, ProcessDisclosureOverrideRecord>
	>({});
	const timelineRef = useRef<HTMLDivElement>(null);
	const timelineContentRef = useRef<HTMLDivElement>(null);
	const shouldFollowTimelineRef = useRef(true);
	const previousSessionIdRef = useRef(sessionId);
	const updateDisclosureOverride = useCallback(
		(
			turnId: string,
			override: ProcessDisclosureOverride,
			lifecycle: AgentTurnViewModel["lifecycle"],
		) => {
			setDisclosureOverrides((current) => {
				const currentRecord = current[turnId];
				if (currentRecord?.value === override && currentRecord.lifecycle === lifecycle) {
					return current;
				}
				return { ...current, [turnId]: { lifecycle, value: override } };
			});
		},
		[],
	);
	const items = useMemo<TimelineRenderItem[]>(() => {
		const timelineItems = turns.map((turn): TimelineRenderItem => ({ type: "turn", turn }));
		const alertItems = runtimeAlerts.map(
			(alert): TimelineRenderItem => ({ type: "runtime-alert", alert }),
		);
		if (!isRunning || turns.length > 0) return [...timelineItems, ...alertItems];

		return [...timelineItems, ...alertItems, { type: "running", id: "agent-running" }];
	}, [isRunning, runtimeAlerts, turns]);

	useLayoutEffect(() => {
		if (previousSessionIdRef.current !== sessionId) {
			previousSessionIdRef.current = sessionId;
			shouldFollowTimelineRef.current = true;
		}
		const timeline = timelineRef.current;
		if (timeline && shouldFollowTimelineRef.current) timeline.scrollTop = timeline.scrollHeight;
	}, [items, sessionId]);

	useEffect(() => {
		const timeline = timelineRef.current;
		const content = timelineContentRef.current;
		if (!timeline || !content || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (shouldFollowTimelineRef.current) timeline.scrollTop = timeline.scrollHeight;
		});
		observer.observe(content);
		return () => observer.disconnect();
	}, [isHydrating]);

	const handleTimelineScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
		const timeline = event.currentTarget;
		const remaining = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop;
		shouldFollowTimelineRef.current = remaining <= 48;
	}, []);

	if (isHydrating && turns.length === 0) {
		return (
			<div
				className={cn(
					"agent-timeline flex h-full items-center justify-center gap-2 text-xs text-muted-foreground",
					className,
				)}
			>
				<LoaderCircle className="size-3.5 animate-spin text-primary" />
				<span>正在加载会话…</span>
			</div>
		);
	}

	return (
		<div
			ref={timelineRef}
			className={cn("agent-timeline h-full overflow-y-auto", className)}
			data-agent-session={sessionId ?? "pending"}
			data-testid="agent-timeline"
			onScroll={handleTimelineScroll}
		>
			<div
				ref={timelineContentRef}
				className="flex min-h-full flex-col justify-end"
				data-testid="agent-timeline-list"
			>
				{items.map((item, index) => (
					<div
						key={timelineRenderItemKey(item, index)}
						className={cn("agent-timeline-row w-full px-4 pb-3", index === 0 && "pt-4")}
					>
						{renderTimelineItem(item, onA2UIAction, disclosureOverrides, updateDisclosureOverride)}
					</div>
				))}
			</div>
		</div>
	);
};

type TimelineRenderItem =
	| { type: "turn"; turn: AgentTurnViewModel }
	| { type: "runtime-alert"; alert: AgentRuntimeAlert }
	| { type: "running"; id: string };

interface ProcessDisclosureOverrideRecord {
	lifecycle: AgentTurnViewModel["lifecycle"];
	value: ProcessDisclosureOverride;
}

const timelineRenderItemKey = (item: TimelineRenderItem | undefined, index: number) => {
	if (!item) return `agent-timeline-placeholder:${index}`;
	if (item.type === "turn") return `agent-turn:${item.turn.id}`;
	if (item.type === "runtime-alert") return `runtime-alert:${item.alert.id}`;
	return item.id;
};

const renderTimelineItem = (
	item: TimelineRenderItem | undefined,
	onA2UIAction?: AgentA2UIActionHandler,
	disclosureOverrides: Record<string, ProcessDisclosureOverrideRecord> = {},
	onDisclosureOverrideChange?: (
		turnId: string,
		override: ProcessDisclosureOverride,
		lifecycle: AgentTurnViewModel["lifecycle"],
	) => void,
) => {
	if (!item) return null;
	if (item.type === "runtime-alert") return <RuntimeAlertCard alert={item.alert} />;
	if (item.type === "running") return <TimelineRunning />;

	return (
		<TimelineTurn
			turn={item.turn}
			disclosureOverride={effectiveDisclosureOverride(disclosureOverrides[item.turn.id], item.turn)}
			onDisclosureOverrideChange={(override) =>
				onDisclosureOverrideChange?.(item.turn.id, override, item.turn.lifecycle)
			}
			onA2UIAction={onA2UIAction}
		/>
	);
};

const effectiveDisclosureOverride = (
	record: ProcessDisclosureOverrideRecord | undefined,
	turn: AgentTurnViewModel,
): ProcessDisclosureOverride => {
	if (!record) return "auto";
	if (turn.lifecycle === "completed" && record.lifecycle !== "completed") return "auto";
	return record.value;
};

const useAgentElapsedClock = (active: boolean) => {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [active]);

	return now;
};

const turnProjectionFromConversation = (
	status: AgentConversationStatus | undefined,
	isRunning: boolean,
	isWaitingForPermission: boolean,
	startedAt?: string,
	updatedAt?: string,
): AgentTurnProjectionState | undefined => {
	const started: AgentTurnProjectionState = startedAt ? { startedAt } : {};
	const terminalTiming = {
		...started,
		...(updatedAt ? { completedAt: updatedAt } : {}),
	};
	if (status === "failed") {
		return { ...terminalTiming, lifecycle: "completed", outcome: "failed" };
	}
	if (status === "interrupted" || status === "paused") {
		return { ...terminalTiming, lifecycle: "completed", outcome: "interrupted" };
	}
	if (status === "cancelled") {
		return { ...terminalTiming, lifecycle: "completed", outcome: "cancelled" };
	}
	if (status === "completed") {
		return { ...terminalTiming, lifecycle: "completed", outcome: "succeeded" };
	}
	if (status === "pending") return { ...started, lifecycle: "pending", outcome: null };
	if (status === "waiting" || (isRunning && isWaitingForPermission)) {
		return { ...started, lifecycle: "waiting", outcome: null };
	}
	if (status === "running" || isRunning) {
		return { ...started, lifecycle: "in_progress", outcome: null };
	}
	return undefined;
};

const TimelineTurn: React.FC<{
	turn: AgentTurnViewModel;
	disclosureOverride: ProcessDisclosureOverride;
	onDisclosureOverrideChange: (override: ProcessDisclosureOverride) => void;
	onA2UIAction?: AgentA2UIActionHandler;
}> = memo(({ turn, disclosureOverride, onDisclosureOverrideChange, onA2UIAction }) => {
	const processItems = visibleTimelineProcessItems(turn);
	const showProcess =
		processItems.length > 0 ||
		turn.lifecycle !== "completed" ||
		(turn.outcome !== null && turn.outcome !== "succeeded");
	const hasAssistantContent =
		showProcess || turn.finalAnswerItems.length > 0 || turn.interactionItems.length > 0;

	return (
		<section className="agent-turn space-y-3" data-agent-turn-id={turn.id}>
			{turn.userMessage ? <TimelineUserTurn message={turn.userMessage} /> : null}
			{hasAssistantContent ? (
				<div className="agent-turn-response w-full min-w-0 space-y-3 px-1">
					{showProcess ? (
						<ProcessDisclosure
							turnId={turn.id}
							lifecycle={turn.lifecycle}
							outcome={turn.outcome}
							durationMs={turn.durationMs}
							itemCount={turn.processSummary.itemCount}
							override={disclosureOverride}
							onOverrideChange={onDisclosureOverrideChange}
						>
							{processItems.length > 0 ? (
								<TimelineProcessItems messages={processItems} />
							) : (
								<TimelineProcessEmpty lifecycle={turn.lifecycle} outcome={turn.outcome} />
							)}
						</ProcessDisclosure>
					) : null}
					{turn.finalAnswerItems.map((message) => (
						<TimelineFinalAnswer key={message.itemId ?? message.id} message={message} />
					))}
					{turn.interactionItems.map((message) => (
						<TimelineAssistantItem
							key={message.itemId ?? message.id}
							message={message}
							onA2UIAction={onA2UIAction}
						/>
					))}
				</div>
			) : null}
		</section>
	);
});

const visibleTimelineProcessItems = (turn: AgentTurnViewModel) =>
	turn.lifecycle === "completed"
		? turn.processItems
		: turn.processItems.filter((message) => message.kind !== "plan");

const TimelineUserTurn: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const legacyAttachments = legacyDisplayAttachments(message.content);
	const attachments = uniqueDisplayAttachments(
		message.metadata?.displayAttachments ?? legacyAttachments,
	);
	const segments = displaySegmentsFromMetadata(message.metadata);
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
					{segments.length > 0 ? (
						<p className="whitespace-pre-wrap break-words">
							{segments.map((segment, index) => (
								<UserPromptSegment key={index} segment={segment} />
							))}
						</p>
					) : content ? (
						<p className="whitespace-pre-wrap break-words">{content}</p>
					) : null}
				</article>
			</div>
		</div>
	);
});

const UserPromptSegment: React.FC<{ segment: AgentDisplaySegment }> = ({ segment }) => {
	if (segment.type === "text") return <>{segment.text}</>;

	if (segment.type === "skill") {
		return (
			<span className="agent-bubble-chip" title={segment.title || segment.name}>
				<span className="agent-skill-chip-icon" aria-hidden="true" />
				<span className="agent-bubble-chip-title">{segment.title || segment.name}</span>
			</span>
		);
	}

	return (
		<span className="agent-bubble-chip" data-kind={segment.kind} title={segment.title}>
			<span className="agent-reference-mention-icon" aria-hidden="true" />
			<span className="agent-bubble-chip-title">{segment.title}</span>
		</span>
	);
};

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

const TimelineProcessItems: React.FC<{ messages: AgentMessage[] }> = memo(({ messages }) => {
	const items = useMemo(() => groupAssistantMessages(messages), [messages]);
	return (
		<div className="agent-process-stream space-y-2">
			{items.map((item) =>
				item.type === "thoughts" ? (
					<ProcessThoughtGroup key={item.id} messages={item.messages} />
				) : item.type === "tools" ? (
					<ToolGroup key={item.id} messages={item.messages} />
				) : (
					<TimelineProcessItem
						key={item.message.itemId ?? item.message.id}
						message={item.message}
					/>
				),
			)}
		</div>
	);
});

const TimelineProcessEmpty: React.FC<{
	lifecycle: AgentTurnViewModel["lifecycle"];
	outcome: AgentTurnViewModel["outcome"];
}> = ({ lifecycle, outcome }) => (
	<div className="agent-process-empty flex items-center gap-2 py-1 text-muted-foreground">
		{lifecycle !== "completed" ? (
			<LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
		) : null}
		<span>{emptyProcessLabel(lifecycle, outcome)}</span>
	</div>
);

const emptyProcessLabel = (
	lifecycle: AgentTurnViewModel["lifecycle"],
	outcome: AgentTurnViewModel["outcome"],
) => {
	if (lifecycle === "waiting") return "正在等待确认…";
	if (lifecycle !== "completed") return "正在准备第一项操作…";
	if (outcome === "failed") return "运行在产生过程记录前失败。";
	if (outcome === "interrupted") return "运行在产生过程记录前中断。";
	if (outcome === "cancelled") return "运行已取消。";
	if (outcome === "refused") return "运行已拒绝。";
	return "没有可显示的过程记录。";
};

const ProcessThoughtGroup: React.FC<{ messages: AgentMessage[] }> = memo(({ messages }) => {
	const content = readableThoughtContent(messages);
	return (
		<article className="agent-process-thought grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-2 py-1 text-muted-foreground">
			<Brain className="mt-1 size-3.5" aria-hidden="true" />
			<div className="agent-process-markdown min-w-0 leading-5">
				<span className="sr-only">思考：</span>
				<MarkdownContent content={content} />
			</div>
		</article>
	);
});

const TimelineProcessItem: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	const kind = message.kind ?? "message";
	if (kind === "message") {
		return (
			<article
				className={cn(
					"agent-process-commentary min-w-0 py-1 leading-5 text-foreground",
					message.status === "error" && "text-error-foreground",
				)}
			>
				<MarkdownContent content={message.content} />
			</article>
		);
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

const TimelineAssistantItem: React.FC<{
	message: AgentMessage;
	onA2UIAction?: AgentA2UIActionHandler;
}> = memo(({ message, onA2UIAction }) => {
	if (message.metadata?.form) {
		return <AgentFormCard message={message} />;
	}

	if (message.metadata?.a2ui) {
		return <TimelineA2UIItem message={message} onA2UIAction={onA2UIAction} />;
	}

	return <TimelineFinalAnswer message={message} />;
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

const TimelineFinalAnswer: React.FC<{ message: AgentMessage }> = memo(({ message }) => {
	if (!message.content.trim() && message.status !== "streaming") return null;
	return (
		<article
			className={cn(
				"agent-final-answer w-full min-w-0 text-xs leading-5 text-foreground",
				message.status === "error" ? "text-error-foreground" : "text-foreground",
			)}
		>
			<div className="agent-final-answer-content">
				<MarkdownContent content={message.content} />
				{message.status === "streaming" ? <StreamingCursor /> : null}
			</div>
		</article>
	);
});

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
						</div>
					) : null}
				</div>
			</div>
		</article>
	);
});

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
	return (
		kind === "agent_permission" || kind === "document_tool_approval" || kind === "agent_selection"
	);
};

const shouldKeepA2UIResultInTimeline = (action: A2uiClientAction) => {
	const kind = action.context?.kind;
	return kind === "agent_permission" || kind === "agent_selection";
};

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
