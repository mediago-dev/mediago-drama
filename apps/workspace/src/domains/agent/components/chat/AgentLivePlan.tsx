import { ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import type React from "react";
import { useId, useMemo, useState } from "react";
import type { AgentACPPlanEntry, AgentMessage } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { PlanBlock } from "../timeline/PlanBlock";

export interface ActiveAgentPlan {
	entries: AgentACPPlanEntry[];
	currentStep: number;
}

interface AgentLivePlanProps {
	isRunning: boolean;
	messages: AgentMessage[];
	className?: string;
}

/** Returns the latest structured plan and its one-based current step. */
export const activePlanFromMessages = (
	messages: readonly AgentMessage[],
): ActiveAgentPlan | null => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const entries = message?.kind === "plan" ? message.metadata?.planEntries : undefined;
		if (!entries?.length) continue;

		const currentIndex = planCurrentEntryIndex(entries);
		return { entries, currentStep: currentIndex + 1 };
	}
	return null;
};

/** Shows the active plan above the composer while an agent run is live. */
export const AgentLivePlan: React.FC<AgentLivePlanProps> = ({ isRunning, messages, className }) => {
	const plan = useMemo(() => activePlanFromMessages(messages), [messages]);
	const [expanded, setExpanded] = useState(true);
	const reactId = useId();
	const regionId = `agent-live-plan-${reactId}`;

	if (!isRunning || !plan) return null;

	const progressLabel = `第 ${plan.currentStep} / ${plan.entries.length} 步`;
	const buttonLabel = `${expanded ? "收起" : "展开"}执行计划，${progressLabel}`;
	const CurrentIcon =
		plan.entries[plan.currentStep - 1]?.status === "in_progress" ? LoaderCircle : null;

	return (
		<aside
			className={cn("agent-live-plan px-4", className)}
			data-testid="agent-live-plan"
			aria-live="polite"
		>
			<div className="agent-live-plan-stack mx-auto flex w-full max-w-xl flex-col items-center">
				{expanded ? (
					<div
						id={regionId}
						role="region"
						aria-label="执行计划"
						className="agent-live-plan-card w-full"
					>
						<PlanBlock content="" entries={plan.entries} />
					</div>
				) : null}
				<button
					type="button"
					className="agent-live-plan-toggle"
					aria-controls={regionId}
					aria-expanded={expanded}
					aria-label={buttonLabel}
					onClick={() => setExpanded((value) => !value)}
				>
					{CurrentIcon ? (
						<CurrentIcon className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
					) : (
						<span className="agent-live-plan-dot" aria-hidden="true" />
					)}
					<span>{progressLabel}</span>
					{expanded ? (
						<ChevronDown className="size-3.5" aria-hidden="true" />
					) : (
						<ChevronUp className="size-3.5" aria-hidden="true" />
					)}
				</button>
			</div>
		</aside>
	);
};

const planCurrentEntryIndex = (entries: readonly AgentACPPlanEntry[]) => {
	const inProgressIndex = entries.findIndex((entry) => entry.status === "in_progress");
	if (inProgressIndex >= 0) return inProgressIndex;

	const failedIndex = entries.findIndex((entry) => entry.status === "failed");
	if (failedIndex >= 0) return failedIndex;

	const pendingIndex = entries.findIndex((entry) => entry.status === "pending");
	if (pendingIndex >= 0) return pendingIndex;

	return Math.max(0, entries.length - 1);
};
