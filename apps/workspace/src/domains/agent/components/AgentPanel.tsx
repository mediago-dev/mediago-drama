import { Bot, ChevronDown, History, Loader2, Plus } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useSWRConfig } from "swr";
import {
	agentChatKey,
	agentSessionsKey,
	createAgentSession,
	getAgentChatState,
	listAgentSessions,
	type AgentChatStatePayload,
	type AgentSessionSummary,
} from "@/domains/agent/api/agent";
import { AgentChat } from "@/domains/agent/components/AgentChat";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
	selectAgentComposerSeed,
	selectAgentIsRunning,
	selectAgentSessionId,
	useAgentStore,
} from "@/domains/agent/stores";
import { setPersistedAgentSessionId } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { cn } from "@/shared/lib/utils";

export const AgentPanel: React.FC<{ width?: number }> = ({ width }) => {
	const isRunning = useAgentStore(selectAgentIsRunning);
	const activeSessionId = useAgentStore(selectAgentSessionId);
	const composerSeed = useAgentStore(selectAgentComposerSeed);
	const projectId = useProjectStore((state) => state.activeProjectId);
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const [isCreatingSession, setIsCreatingSession] = useState(false);
	const historyMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (composerSeed) setIsHistoryOpen(false);
	}, [composerSeed]);

	useEffect(() => {
		if (!isHistoryOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && historyMenuRef.current?.contains(target)) return;
			setIsHistoryOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsHistoryOpen(false);
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isHistoryOpen]);

	const handleCreateSession = async () => {
		if (isRunning || isCreatingSession) return;

		const requestedProjectId = projectId;
		setIsCreatingSession(true);
		try {
			const session = await createAgentSession(requestedProjectId, true);
			if (!isCurrentProject(requestedProjectId)) return;
			const state: AgentChatStatePayload = {
				projectId: requestedProjectId ?? undefined,
				sessionId: session.sessionId,
				messages: [],
				activity: [],
				running: false,
			};
			useAgentStore.getState().hydrateAgentChatState([], [], {
				sessionId: session.sessionId,
				lastEventId: null,
				running: false,
			});
			if (requestedProjectId) setPersistedAgentSessionId(requestedProjectId, session.sessionId);
			setIsHistoryOpen(false);
			void mutate(agentChatKey(requestedProjectId, session.sessionId), state, {
				revalidate: false,
			});
			void mutate(agentSessionsKey(requestedProjectId));
		} catch (err) {
			if (isCurrentProject(requestedProjectId)) {
				toast.error("新建会话失败", { description: getErrorMessage(err) });
			}
		} finally {
			setIsCreatingSession(false);
		}
	};

	return (
		<aside
			className="agent-panel-shell flex h-full min-h-0 w-full shrink-0 flex-col bg-ide-panel text-ide-panel-foreground"
			style={width ? { width } : undefined}
		>
			<header className="agent-panel-header flex items-center justify-between gap-3 border-b border-border bg-ide-toolbar/95 px-3 py-2 text-ide-toolbar-foreground">
				<div className="flex min-w-0 items-center gap-2">
					<div className="agent-brand-mark flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground">
						<Bot className="size-4" />
					</div>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold text-foreground">文档智能体</h1>
						<p className="truncate text-xs text-muted-foreground">通过操作更新文档</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<span className="agent-status-pill hidden items-center gap-1.5 rounded-sm border border-border bg-ide-panel px-2 py-1 text-caption text-muted-foreground sm:flex">
						<span
							className={cn(
								"size-1.5 rounded-full",
								isRunning ? "animate-pulse bg-success-foreground" : "bg-muted-foreground",
							)}
							aria-hidden="true"
						/>
						{isRunning ? "运行中" : "就绪"}
					</span>
					<div ref={historyMenuRef} className="relative">
						<Button
							variant={isHistoryOpen ? "secondary" : "ghost"}
							size="sm"
							className="agent-header-button"
							onClick={() => setIsHistoryOpen((open) => !open)}
							aria-expanded={isHistoryOpen}
							aria-haspopup="menu"
							title="历史会话"
						>
							<History />
							<span className="hidden sm:inline">历史会话</span>
							<ChevronDown className={cn("transition-transform", isHistoryOpen && "rotate-180")} />
						</Button>
						{isHistoryOpen ? (
							<AgentSessionHistoryMenu
								activeSessionId={activeSessionId}
								projectId={projectId}
								onClose={() => setIsHistoryOpen(false)}
							/>
						) : null}
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="agent-header-button"
						onClick={handleCreateSession}
						disabled={isRunning || isCreatingSession}
						title={isRunning ? "当前运行结束后再新建会话" : "新建会话"}
					>
						{isCreatingSession ? <Loader2 className="animate-spin" /> : <Plus />}
						<span className="hidden sm:inline">新建会话</span>
					</Button>
				</div>
			</header>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<AgentChat />
			</div>
		</aside>
	);
};

const AgentSessionHistoryMenu: React.FC<{
	activeSessionId: string | null;
	projectId: string | null;
	onClose: () => void;
}> = ({ activeSessionId, projectId, onClose }) => {
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
	const {
		data: sessions = [],
		error,
		isLoading,
	} = useSWR(projectId ? agentSessionsKey(projectId) : null, () => listAgentSessions(projectId));

	useEffect(() => {
		setLoadingSessionId(null);
	}, [projectId]);

	const selectSession = async (session: AgentSessionSummary) => {
		if (!projectId || loadingSessionId) return;

		const requestedProjectId = projectId;
		const requestedSessionId = session.sessionId;
		setLoadingSessionId(session.sessionId);
		try {
			const state = await getAgentChatState(requestedProjectId, requestedSessionId);
			const resolvedSessionId = state.sessionId?.trim() || requestedSessionId;
			if (
				!isCurrentProject(requestedProjectId) ||
				(state.projectId && state.projectId !== requestedProjectId) ||
				(state.sessionId && resolvedSessionId !== requestedSessionId)
			) {
				return;
			}

			useAgentStore.getState().hydrateAgentChatState(state.messages, state.activity, {
				sessionId: resolvedSessionId,
				lastEventId: state.lastEventId,
				running: state.running,
				pendingPermissions: state.pendingPermissions,
			});
			setPersistedAgentSessionId(requestedProjectId, resolvedSessionId);
			void mutate(agentChatKey(requestedProjectId, resolvedSessionId), state, {
				revalidate: false,
			});
			onClose();
		} catch (err) {
			if (isCurrentProject(requestedProjectId)) {
				toast.error("加载历史会话失败", { description: getErrorMessage(err) });
			}
		} finally {
			setLoadingSessionId(null);
		}
	};

	if (!projectId) {
		return (
			<div
				className="agent-history-menu absolute right-0 top-full z-50 mt-1 w-72 rounded-sm border border-border bg-popover p-3 text-sm text-muted-foreground shadow-lg"
				role="menu"
			>
				打开项目后可以查看历史会话。
			</div>
		);
	}

	return (
		<section
			className="agent-history-menu absolute right-0 top-full z-50 mt-1 flex max-h-[min(28rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] min-w-72 flex-col overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-lg"
			role="menu"
		>
			<div className="border-b border-border px-3 py-2">
				<h2 className="text-sm font-semibold text-foreground">历史会话</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">点击任一会话恢复当时的对话上下文。</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{isLoading ? (
					<div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						正在加载历史会话
					</div>
				) : error ? (
					<div className="border border-error-border bg-error-surface px-2 py-2 text-sm text-error-foreground">
						历史会话加载失败。
					</div>
				) : sessions.length === 0 ? (
					<div className="px-2 py-3 text-sm text-muted-foreground">还没有历史会话。</div>
				) : (
					<div className="space-y-1">
						{sessions.map((session) => {
							const isActive = session.sessionId === activeSessionId;
							const isLoadingSession = loadingSessionId === session.sessionId;
							const title = session.title?.trim() || shortSessionID(session.sessionId);
							return (
								<button
									key={session.sessionId}
									type="button"
									role="menuitem"
									onClick={() => selectSession(session)}
									disabled={Boolean(loadingSessionId)}
									className={cn(
										"agent-history-item flex w-full items-start gap-2 rounded-sm border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-ide-list-hover disabled:pointer-events-none disabled:opacity-60",
										isActive && "agent-history-item-active border-info-border bg-info-surface",
									)}
								>
									<div className="agent-history-icon mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar">
										{isLoadingSession ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<History className="size-3.5" />
										)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span
												className="truncate text-sm font-medium text-foreground"
												title={session.sessionId}
											>
												{title}
											</span>
											<span
												className={cn(
													"agent-history-status shrink-0 rounded-sm border px-1.5 py-0.5 text-2xs",
													sessionStatusClassName(session),
												)}
											>
												{sessionStatusLabel(session)}
											</span>
											{isActive ? (
												<span className="shrink-0 text-2xs text-info-foreground">当前</span>
											) : null}
										</div>
										<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
											{session.lastMessage || "尚未运行"}
										</p>
										<div className="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
											<span>{formatSessionTimestamp(session.updatedAt)}</span>
										</div>
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
};

const shortSessionID = (sessionId: string) => {
	if (sessionId.length <= 16) return sessionId;
	return `${sessionId.slice(0, 12)}…`;
};

const isCurrentProject = (projectId: string | null) =>
	useProjectStore.getState().activeProjectId === projectId;

const sessionStatusLabel = (session: AgentSessionSummary) => {
	if (session.running) return "运行中";
	switch (session.lastStatus) {
		case "completed":
			return "完成";
		case "failed":
			return "失败";
		case "cancelled":
			return "已取消";
		case "interrupted":
			return "已中断";
		case "paused":
			return "已暂停";
		case "waiting":
			return "等待";
		case "running":
			return "运行中";
		default:
			return "空会话";
	}
};

const sessionStatusClassName = (session: AgentSessionSummary) => {
	if (session.running || session.lastStatus === "running" || session.lastStatus === "waiting") {
		return "border-warning-border bg-warning-surface text-warning-foreground";
	}
	if (session.lastStatus === "completed") {
		return "border-success-border bg-success-surface text-success-foreground";
	}
	if (
		session.lastStatus === "failed" ||
		session.lastStatus === "interrupted" ||
		session.lastStatus === "paused"
	) {
		return "border-error-border bg-error-surface text-error-foreground";
	}
	return "border-border bg-ide-toolbar text-muted-foreground";
};

const formatSessionTimestamp = (value?: string) => {
	if (!value) return "未运行";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
};

const getErrorMessage = (err: unknown) => {
	if (err instanceof Error && err.message) return err.message;
	return "请稍后重试。";
};
