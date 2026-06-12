import { FilePenLine, MessageSquare, TerminalSquare, Workflow } from "lucide-react";
import type React from "react";
import { selectAgentActivity, useAgentStore, type ActivityKind } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";

const iconByKind: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
	message: MessageSquare,
	tool: TerminalSquare,
	patch: FilePenLine,
	runtime: Workflow,
};

export const AgentActivity: React.FC = () => {
	const activity = useAgentStore(selectAgentActivity);

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-panel">
			<div className="flex items-center justify-between border-b border-border bg-ide-toolbar px-3 py-2">
				<h2 className="text-sm font-semibold text-foreground">活动</h2>
				<span className="text-xs text-muted-foreground">{activity.length}</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{activity.map((item) => {
					const Icon = iconByKind[item.kind];

					return (
						<div key={item.id} className="border-b border-border px-2 py-2 last:border-b-0">
							<div className="flex items-center gap-1.5">
								<span
									className={cn(
										"flex size-6 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground",
									)}
								>
									<Icon className="size-3.5" />
								</span>
								<p className="min-w-0 truncate text-xs font-medium text-foreground">{item.label}</p>
							</div>
							<p className="mt-1 line-clamp-2 pl-7 text-xs leading-5 text-muted-foreground">
								{item.detail}
							</p>
						</div>
					);
				})}
			</div>
		</section>
	);
};
