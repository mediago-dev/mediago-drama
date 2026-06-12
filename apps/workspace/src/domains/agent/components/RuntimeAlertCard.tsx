import { AlertTriangle, ShieldAlert } from "lucide-react";
import type React from "react";
import type { AgentRuntimeAlert } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";

interface RuntimeAlertCardProps {
	alert: AgentRuntimeAlert;
}

export const RuntimeAlertCard: React.FC<RuntimeAlertCardProps> = ({ alert }) => {
	const isError = alert.severity === "error";
	const Icon = isError ? AlertTriangle : ShieldAlert;
	const createdAt = alert.createdAt ? new Date(alert.createdAt) : new Date();

	return (
		<div
			className={cn(
				"rounded-sm border px-2 py-2 text-xs",
				isError
					? "border-error-border bg-error-surface text-error-foreground"
					: "border-warning-border bg-warning-surface text-warning-foreground",
			)}
		>
			<div className="flex items-start gap-2">
				<span
					className={cn(
						"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border bg-ide-toolbar",
						isError ? "border-error-border" : "border-warning-border",
					)}
				>
					<Icon className="size-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-2">
						<p className="font-medium">{alert.title || "运行时警告"}</p>
						<span className="text-caption text-muted-foreground">
							{createdAt.toLocaleTimeString("zh-CN", {
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							})}
						</span>
					</div>
					<p className="mt-1 leading-5 text-foreground">{alert.message}</p>
					{alert.reason || alert.detail ? (
						<p className="mt-2 rounded-sm border border-border bg-ide-toolbar px-2 py-1 font-mono text-2xs text-muted-foreground">
							{[alert.reason, alert.detail].filter(Boolean).join(" · ")}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};
