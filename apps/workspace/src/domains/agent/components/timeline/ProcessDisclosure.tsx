import { ChevronDown } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { AgentTurnLifecycle, AgentTurnOutcome } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";

export type ProcessDisclosureOverride = "auto" | "manual-open" | "manual-closed";

interface ProcessDisclosureProps {
	turnId: string;
	lifecycle: AgentTurnLifecycle;
	outcome: AgentTurnOutcome | null;
	durationMs?: number;
	itemCount: number;
	children: ReactNode;
	override?: ProcessDisclosureOverride;
	onOverrideChange?: (override: ProcessDisclosureOverride) => void;
}

interface OverrideState {
	lifecycle: AgentTurnLifecycle;
	turnId: string;
	value: ProcessDisclosureOverride;
}

/**
 * ProcessDisclosure renders the single turn-level disclosure that owns Agent process output.
 * Successful terminal turns auto-collapse; failed/interrupted turns stay open for inspection.
 */
export const ProcessDisclosure = ({
	turnId,
	lifecycle,
	outcome,
	durationMs,
	itemCount,
	children,
	override: controlledOverride,
	onOverrideChange,
}: ProcessDisclosureProps) => {
	const reactId = useId().replaceAll(":", "");
	const triggerId = `agent-process-trigger-${reactId}`;
	const contentId = `agent-process-content-${reactId}`;
	const automaticExpanded = isAutomaticallyExpanded(lifecycle, outcome);
	const [overrideState, setOverrideState] = useState<OverrideState>({
		lifecycle,
		turnId,
		value: "auto",
	});
	const localOverride =
		overrideState.turnId === turnId
			? effectiveOverrideForLifecycle(overrideState.value, overrideState.lifecycle, lifecycle)
			: "auto";
	const override = controlledOverride ?? localOverride;
	const expanded = resolveExpanded(override, automaticExpanded);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const contentSizerRef = useRef<HTMLDivElement | null>(null);
	const wasExpandedRef = useRef(expanded);
	const [contentHeight, setContentHeight] = useState(0);
	const [motionReady, setMotionReady] = useState(false);

	useLayoutEffect(() => {
		const wasExpanded = wasExpandedRef.current;
		wasExpandedRef.current = expanded;
		if (!wasExpanded || expanded) return;

		const activeElement = document.activeElement;
		if (
			activeElement instanceof Node &&
			contentSizerRef.current?.contains(activeElement) &&
			triggerRef.current
		) {
			triggerRef.current.focus({ preventScroll: true });
		}
	}, [expanded]);

	useLayoutEffect(() => {
		const element = contentSizerRef.current;
		if (!element) return;

		const updateHeight = (nextHeight = element.getBoundingClientRect().height) => {
			const roundedHeight = Math.max(0, Math.ceil(nextHeight));
			setContentHeight((currentHeight) =>
				currentHeight === roundedHeight ? currentHeight : roundedHeight,
			);
		};
		const blockSizeFromEntry = (entry: ResizeObserverEntry) => {
			const borderBoxSize = entry.borderBoxSize;
			return borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height;
		};
		const updateHeightFromWindowResize = () => updateHeight();

		updateHeight();
		setMotionReady(false);

		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver((entries) => {
				const nextHeight = entries[0] ? blockSizeFromEntry(entries[0]) : undefined;
				updateHeight(nextHeight);
			});
			observer.observe(element);
		} else {
			window.addEventListener("resize", updateHeightFromWindowResize);
		}

		const frame = window.requestAnimationFrame(() => {
			updateHeight();
			setMotionReady(true);
		});

		return () => {
			window.cancelAnimationFrame(frame);
			observer?.disconnect();
			if (!observer) window.removeEventListener("resize", updateHeightFromWindowResize);
		};
	}, [turnId]);

	const toggle = () => {
		const nextOverride = expanded ? "manual-closed" : "manual-open";
		if (controlledOverride === undefined) {
			setOverrideState({ lifecycle, turnId, value: nextOverride });
		}
		onOverrideChange?.(nextOverride);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		toggle();
	};

	const label = processStatusLabel(lifecycle, outcome);
	const duration = formatProcessDuration(durationMs);
	const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0;
	const error = outcome === "failed" || outcome === "interrupted";
	const contentStyle = {
		"--agent-process-content-height": `${contentHeight}px`,
	} as CSSProperties;

	return (
		<section
			className="agent-process-disclosure min-w-0 text-xs"
			data-disclosure-mode={override}
			data-state={expanded ? "open" : "closed"}
		>
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				className={cn(
					"group flex min-h-7 w-full items-center gap-1.5 rounded-sm py-1 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
					error && "text-error-foreground hover:text-error-foreground",
					lifecycle === "waiting" && "text-warning-foreground",
				)}
				onClick={toggle}
				onKeyDown={handleKeyDown}
				aria-expanded={expanded}
				aria-controls={contentId}
			>
				<span className="font-medium">{label}</span>
				{duration ? <span className="tabular-nums">{duration}</span> : null}
				{count > 0 ? <span>· {count} 项</span> : null}
				<ChevronDown
					className={cn(
						"size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
						!expanded && "-rotate-90",
					)}
					aria-hidden="true"
				/>
			</button>
			<div
				id={contentId}
				role="region"
				aria-labelledby={triggerId}
				aria-hidden={!expanded}
				inert={!expanded ? true : undefined}
				className="agent-process-disclosure-viewport"
				data-motion-ready={motionReady ? "true" : "false"}
				data-state={expanded ? "open" : "closed"}
				style={contentStyle}
			>
				<div
					ref={contentSizerRef}
					className="agent-process-disclosure-sizer min-w-0 border-t border-border pt-3 text-foreground"
				>
					{children}
				</div>
			</div>
		</section>
	);
};

const resolveExpanded = (override: ProcessDisclosureOverride, automaticExpanded: boolean) => {
	if (override === "manual-open") return true;
	if (override === "manual-closed") return false;
	return automaticExpanded;
};

const effectiveOverrideForLifecycle = (
	override: ProcessDisclosureOverride,
	overrideLifecycle: AgentTurnLifecycle,
	currentLifecycle: AgentTurnLifecycle,
) => {
	if (currentLifecycle === "completed" && overrideLifecycle !== "completed") return "auto";
	return override;
};

const isAutomaticallyExpanded = (
	lifecycle: AgentTurnLifecycle,
	outcome: AgentTurnOutcome | null,
) => {
	if (lifecycle !== "completed") return true;
	return outcome === "failed" || outcome === "interrupted";
};

const processStatusLabel = (lifecycle: AgentTurnLifecycle, outcome: AgentTurnOutcome | null) => {
	if (lifecycle === "pending") return "准备处理";
	if (lifecycle === "in_progress") return "正在处理";
	if (lifecycle === "waiting") return "等待确认";

	switch (outcome) {
		case "failed":
			return "处理失败";
		case "interrupted":
			return "已中断";
		case "cancelled":
			return "已取消";
		case "refused":
			return "已拒绝";
		default:
			return "已处理";
	}
};

const formatProcessDuration = (durationMs?: number) => {
	if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return "";
	if (durationMs < 1000) return "<1s";
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;

	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return [`${hours}h`, minutes > 0 ? `${minutes}m` : "", seconds > 0 ? `${seconds}s` : ""]
			.filter(Boolean)
			.join(" ");
	}
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};
