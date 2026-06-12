import { ChevronRight, TerminalSquare } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { AgentMessage } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { formatTime } from "./format";

export const RuntimeTraceGroup: React.FC<{ messages: AgentMessage[] }> = ({ messages }) => {
	const [expanded, setExpanded] = useState(false);

	return (
		<section className="px-1 text-xs text-muted-foreground">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-2 border-t border-border pt-2 text-left"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
			>
				<span className="flex min-w-0 items-center gap-2">
					<TerminalSquare className="size-3.5 shrink-0" />
					<span className="truncate">连接 / 状态 trace ({messages.length})</span>
				</span>
				<ChevronRight
					className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
				/>
			</button>
			{expanded ? (
				<div className="mt-2 space-y-1 rounded-sm bg-ide-toolbar/50 px-2.5 py-2">
					{messages.map((message) => (
						<div
							key={message.id}
							className="grid gap-1 border-b border-border/50 pb-1 last:border-0 last:pb-0"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="truncate font-medium text-foreground">
									{message.title || "runtime"}
								</span>
								<span className="shrink-0 text-2xs">{formatTime(message.createdAt)}</span>
							</div>
							<p className="whitespace-pre-wrap break-words text-caption">{message.content}</p>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
};
