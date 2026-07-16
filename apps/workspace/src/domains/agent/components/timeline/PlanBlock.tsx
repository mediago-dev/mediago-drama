import { Check, Circle, LoaderCircle, X } from "lucide-react";
import type React from "react";
import type { AgentACPPlanEntry } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";

export const PlanBlock: React.FC<{ content: string; entries?: AgentACPPlanEntry[] }> = ({
	content,
	entries,
}) => {
	if (entries && entries.length > 0) {
		return (
			<ol className="agent-plan-list space-y-1 text-caption text-muted-foreground">
				{entries.map((entry, index) => {
					const Icon = planStatusIcon(entry.status);
					return (
						<li
							key={`${entry.content}-${index}`}
							className={cn(
								"agent-plan-row flex items-start gap-2",
								`agent-plan-row-${entry.status}`,
							)}
						>
							<Icon
								className={cn(
									"agent-plan-status-icon mt-0.5 size-3.5 shrink-0",
									entry.status === "completed" && "text-success-foreground",
									entry.status === "in_progress" && "animate-spin text-warning-foreground",
									entry.status === "failed" && "text-error-foreground",
								)}
							/>
							<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
								{entry.content}
								{entry.priority ? (
									<span className="ml-1 text-2xs text-muted-foreground">{entry.priority}</span>
								) : null}
							</span>
						</li>
					);
				})}
			</ol>
		);
	}

	const steps = content
		.split("\n")
		.map((line) => line.trim().replace(/^(\d+[.)]|[-*])\s*/, ""))
		.filter(Boolean);

	if (steps.length === 0) return <p>暂无计划步骤。</p>;

	return (
		<ol className="agent-plan-list list-decimal space-y-1 pl-4 text-caption text-muted-foreground">
			{steps.map((step, index) => (
				<li key={`${step}-${index}`} className="agent-plan-row whitespace-pre-wrap break-words">
					{step}
				</li>
			))}
		</ol>
	);
};

const planStatusIcon = (status: string) => {
	if (status === "completed") return Check;
	if (status === "in_progress") return LoaderCircle;
	if (status === "failed") return X;
	return Circle;
};
