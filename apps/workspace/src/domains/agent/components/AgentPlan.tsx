import { Check, Circle, CircleSlash, LoaderCircle, XCircle } from "lucide-react";
import type React from "react";
import {
	type AgentActivityItem,
	type AgentConversationState,
	type AgentConversationStatus,
	selectAgentActivity,
	selectAgentConversations,
	selectAgentRootRunId,
	useAgentStore,
} from "@/domains/agent/stores";

const statusIcon: Record<AgentConversationStatus, React.ReactNode> = {
	pending: <Circle className="size-3.5" />,
	running: <LoaderCircle className="size-3.5 animate-spin" />,
	waiting: <LoaderCircle className="size-3.5 animate-spin" />,
	completed: <Check className="size-3.5" />,
	failed: <XCircle className="size-3.5" />,
	interrupted: <CircleSlash className="size-3.5" />,
	paused: <CircleSlash className="size-3.5" />,
	cancelled: <CircleSlash className="size-3.5" />,
};

const statusLabel: Record<AgentConversationStatus, string> = {
	pending: "待处理",
	running: "进行中",
	waiting: "等待确认",
	completed: "完成",
	failed: "失败",
	interrupted: "已中断",
	paused: "已暂停",
	cancelled: "已中断",
};

export const AgentPlan: React.FC = () => {
	const conversations = useAgentStore(selectAgentConversations);
	const rootRunId = useAgentStore(selectAgentRootRunId);
	const activity = useAgentStore(selectAgentActivity);
	const plan = conversationPlan(conversations, rootRunId);
	const fallbackActivity = activity.slice(0, 5);

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-toolbar">
			<div className="px-3 py-2">
				<h2 className="text-sm font-semibold text-foreground">运行</h2>
			</div>
			<div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
				{plan.length > 0 ? (
					plan.map((item) => (
						<div key={item.runId} className="flex items-center gap-2 text-xs">
							<span className="flex size-6 items-center justify-center rounded-sm border border-border bg-ide-panel text-muted-foreground">
								{statusIcon[item.status]}
							</span>
							<span className="min-w-0 flex-1 truncate text-foreground">
								{item.name || "MediaGo Drama 智能体"}
							</span>
							<span className="text-xs text-muted-foreground">{statusLabel[item.status]}</span>
						</div>
					))
				) : fallbackActivity.length > 0 ? (
					fallbackActivity.map((item) => <ActivityPlanItem key={item.id} item={item} />)
				) : (
					<div className="border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
						暂无运行记录。
					</div>
				)}
			</div>
		</section>
	);
};

const ActivityPlanItem: React.FC<{ item: AgentActivityItem }> = ({ item }) => (
	<div className="flex items-center gap-2 text-xs">
		<span className="flex size-6 items-center justify-center rounded-sm border border-border bg-ide-panel text-muted-foreground">
			<Check className="size-3.5" />
		</span>
		<span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
		<span className="text-xs text-muted-foreground">{activityKindLabel[item.kind]}</span>
	</div>
);

const conversationPlan = (
	conversations: Record<string, AgentConversationState>,
	rootRunId: string | null,
) => {
	const ordered: AgentConversationState[] = [];
	const visited = new Set<string>();
	const append = (runId: string) => {
		if (visited.has(runId)) return;
		const conversation = conversations[runId];
		if (!conversation) return;
		visited.add(runId);
		ordered.push(conversation);
		for (const child of conversation.children) append(child);
	};

	if (rootRunId) append(rootRunId);
	for (const conversation of Object.values(conversations)) append(conversation.runId);

	return ordered;
};

const activityKindLabel: Record<AgentActivityItem["kind"], string> = {
	message: "消息",
	tool: "工具",
	patch: "文档",
	runtime: "运行时",
};
