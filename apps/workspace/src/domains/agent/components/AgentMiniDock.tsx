import { Bot, PanelRightOpen } from "lucide-react";
import type React from "react";
import {
	selectAgentExpand,
	selectAgentIsRunning,
	selectAgentLatestActivity,
	useAgentStore,
} from "@/domains/agent/stores";

export const AgentMiniDock: React.FC = () => {
	const expand = useAgentStore(selectAgentExpand);
	const latestActivity = useAgentStore(selectAgentLatestActivity);
	const isRunning = useAgentStore(selectAgentIsRunning);

	return (
		<aside className="flex h-full w-9 shrink-0 flex-col items-center justify-start border-l border-border bg-ide-panel pt-3 text-ide-panel-foreground">
			<button
				type="button"
				onClick={expand}
				aria-label="展开智能体面板"
				title={latestActivity?.label ? `展开智能体面板：${latestActivity.label}` : "展开智能体面板"}
				className="relative flex size-7 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Bot className="size-4" />
				{latestActivity ? (
					<span
						className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-ide-panel bg-info-foreground"
						aria-hidden="true"
					/>
				) : null}
				{isRunning ? (
					<span
						className="absolute -bottom-0.5 -right-0.5 size-2 animate-pulse rounded-full border border-ide-panel bg-success-foreground"
						aria-hidden="true"
					/>
				) : null}
			</button>
			<button
				type="button"
				onClick={expand}
				aria-label="展开智能体面板"
				title="展开智能体面板"
				className="mt-2 flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<PanelRightOpen className="size-4" />
			</button>
		</aside>
	);
};
