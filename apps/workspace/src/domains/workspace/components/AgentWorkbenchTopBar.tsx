import { Bot, PanelRightClose } from "lucide-react";
import type React from "react";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useWorkModeStore, type WorkMode } from "@/lib/stores/work-mode";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface AgentWorkbenchTopBarProps {
	mode?: WorkMode;
	showTabs?: boolean;
}

export const AgentWorkbenchTopBar: React.FC<AgentWorkbenchTopBarProps> = ({ mode, showTabs }) => {
	const storedWorkMode = useWorkModeStore((state) => state.mode);
	const startWindowDrag = useDesktopWindowDrag();
	const workMode = mode ?? storedWorkMode;
	const title = workMode === "studio" ? "生成中心" : "项目制作台";

	return (
		<header
			className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-5 text-ide-toolbar-foreground"
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
	const tab = useAgentLayoutStore((state) => state.tab);
	const setTab = useAgentLayoutStore((state) => state.setTab);
	const storedWorkMode = useWorkModeStore((state) => state.mode);
	const workMode = mode ?? storedWorkMode;
	const shouldShowTabs = showTabs ?? workMode === "agent";

	if (!shouldShowTabs) return null;

	return (
		<Button
			type="button"
			variant={tab === "agent" ? "secondary" : "outline"}
			size="sm"
			className={cn(
				"h-9 gap-2 rounded-lg px-3",
				tab === "agent" && "border-primary/20 bg-primary/10 text-primary",
			)}
			data-desktop-no-drag
			onClick={() => setTab(tab === "agent" ? "document" : "agent")}
			aria-pressed={tab === "agent"}
			aria-label={tab === "agent" ? "收起制作助理" : "打开制作助理"}
			title={tab === "agent" ? "收起底部制作助理" : "打开底部制作助理"}
		>
			{tab === "agent" ? <PanelRightClose className="size-4" /> : <Bot className="size-4" />}
			<span>{tab === "agent" ? "收起助理" : "底部助理"}</span>
		</Button>
	);
};
