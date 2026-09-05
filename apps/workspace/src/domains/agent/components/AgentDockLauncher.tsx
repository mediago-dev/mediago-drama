import { Bot, ChevronUp } from "lucide-react";
import type React from "react";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";

export const AgentDockLauncher: React.FC = () => {
	const setTab = useAgentLayoutStore((state) => state.setTab);
	const setPanelSize = useAgentLayoutStore((state) => state.setPanelSize);

	return (
		<button
			type="button"
			className="group flex h-12 w-full shrink-0 items-center justify-between border-t border-border bg-ide-panel px-4 text-left shadow-[0_-6px_18px_rgba(0,0,0,0.06)] transition-colors hover:bg-ide-list-hover"
			onClick={() => {
				setPanelSize("expanded");
				setTab("agent");
			}}
			aria-label="打开底部制作助理"
		>
			<span className="flex min-w-0 items-center gap-2.5">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Bot className="size-4" />
				</span>
				<span className="truncate text-sm font-medium text-foreground">制作助理</span>
				<span className="hidden truncate text-xs text-muted-foreground sm:inline">
					随时继续当前项目，不会丢失脚本、资产与镜头上下文
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
				展开
				<ChevronUp className="size-4" />
			</span>
		</button>
	);
};
