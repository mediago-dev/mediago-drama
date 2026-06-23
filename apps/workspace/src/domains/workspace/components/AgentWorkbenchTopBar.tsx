import { Bot, FileText } from "lucide-react";
import type React from "react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import {
	agentProjectPath,
	agentProjectRouteState,
	getRouteAgentSessionId,
	getRouteAssetId,
	getRouteDocumentId,
	getRouteProjectId,
	isAgentRoute,
} from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore, type AgentLayoutTab } from "@/lib/stores/agent-layout";
import { useWorkModeStore, type WorkMode } from "@/lib/stores/work-mode";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const tabs: Array<{
	value: AgentLayoutTab;
	label: string;
	icon: React.ElementType;
}> = [
	{ value: "document", label: "文档", icon: FileText },
	{ value: "agent", label: "agent", icon: Bot },
];

interface AgentWorkbenchTopBarProps {
	mode?: WorkMode;
	showTabs?: boolean;
}

export const AgentWorkbenchTopBar: React.FC<AgentWorkbenchTopBarProps> = ({ mode, showTabs }) => {
	const storedWorkMode = useWorkModeStore((state) => state.mode);
	const startWindowDrag = useDesktopWindowDrag();
	const workMode = mode ?? storedWorkMode;
	const title = workMode === "studio" ? "工具箱" : "智能体工作台";

	return (
		<header
			className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-ide-toolbar/95 px-3 text-ide-toolbar-foreground"
			onPointerDown={startWindowDrag}
		>
			<div
				className="flex h-full min-w-0 flex-1 items-center text-sm font-medium text-foreground"
				data-desktop-drag-region
			>
				{title}
			</div>
			<AgentWorkbenchHeaderActions mode={workMode} showTabs={showTabs} />
		</header>
	);
};

export const AgentWorkbenchHeaderActions: React.FC<AgentWorkbenchTopBarProps> = ({
	mode,
	showTabs,
}) => {
	const navigate = useNavigate();
	const location = useLocation();
	const tab = useAgentLayoutStore((state) => state.tab);
	const setTab = useAgentLayoutStore((state) => state.setTab);
	const storedWorkMode = useWorkModeStore((state) => state.mode);
	const workMode = mode ?? storedWorkMode;
	const shouldShowTabs = showTabs ?? workMode === "agent";
	const projectId = getRouteProjectId(location.search);
	const routeAgentSessionId = getRouteAgentSessionId(location.search);
	const routeDocumentId = getRouteDocumentId(location.search);
	const routeAssetId = getRouteAssetId(location.search);
	const selectTab = useCallback(
		(nextTab: AgentLayoutTab) => {
			setTab(nextTab);
			if (workMode !== "agent" || !projectId || !isAgentRoute(location.pathname)) {
				return;
			}
			if (nextTab === "agent") {
				navigate(agentProjectPath(projectId, { agentSessionId: routeAgentSessionId }), {
					state: agentProjectRouteState("agent"),
				});
				return;
			}
			if (!routeDocumentId && !routeAssetId) {
				navigate(agentProjectPath(projectId), {
					replace: true,
					state: agentProjectRouteState("overview"),
				});
			}
		},
		[
			location.pathname,
			navigate,
			projectId,
			routeAgentSessionId,
			routeAssetId,
			routeDocumentId,
			setTab,
			workMode,
		],
	);

	if (!shouldShowTabs) return null;

	return (
		<div
			className="flex h-8 items-center rounded-sm border border-border bg-ide-toolbar p-0.5"
			data-desktop-no-drag
			aria-label="工作台内容"
			role="group"
		>
			{tabs.map((item) => {
				const Icon = item.icon;
				const isActive = tab === item.value;
				const label = item.label;
				return (
					<Button
						key={item.value}
						type="button"
						variant="ghost"
						size="sm"
						className={cn(
							"h-7 rounded-control px-2 text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
							isActive && "bg-ide-list-active text-ide-list-active-foreground",
						)}
						onClick={() => selectTab(item.value)}
						aria-pressed={isActive}
						aria-label={label}
						title={label}
					>
						<Icon className="size-3.5" />
						<span>{label}</span>
					</Button>
				);
			})}
		</div>
	);
};
