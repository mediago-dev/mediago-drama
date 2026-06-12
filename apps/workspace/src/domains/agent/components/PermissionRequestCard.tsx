import { Loader2, ShieldAlert } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
	decideAgentPermission,
	type AgentRuntimeACPPermissionRequest,
} from "@/domains/agent/api/agent";
import { useProjectStore } from "@/domains/projects/stores";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";

interface PermissionRequestCardProps {
	request: AgentRuntimeACPPermissionRequest;
	sessionId: string | null;
	onDecided: () => void;
}

export const PermissionRequestCard: React.FC<PermissionRequestCardProps> = ({
	request,
	sessionId,
	onDecided,
}) => {
	const toast = useToast();
	const projectId = useProjectStore((state) => state.activeProjectId);
	const [decidingOptionId, setDecidingOptionId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const disabled = !projectId || !sessionId || decidingOptionId !== null;
	const title = request.toolCall?.title || request.toolCall?.id || "ACP 工具调用";
	const kind = request.toolCall?.kind || "tool";
	const createdAt = request.createdAt ? new Date(request.createdAt) : new Date();
	const createdAtValue = request.createdAt || createdAt.toISOString();

	const decide = async (optionId: string) => {
		if (!projectId || !sessionId) return;
		setDecidingOptionId(optionId);
		setErrorMessage("");
		try {
			await decideAgentPermission({
				projectId,
				sessionId,
				requestId: request.requestId,
				optionId,
			});
			onDecided();
		} catch (err) {
			const message = getPermissionDecisionError(err);
			setErrorMessage(message);
			toast.error("权限确认失败", { description: message });
			if (isStalePermissionRequestError(err, message)) onDecided();
		} finally {
			setDecidingOptionId(null);
		}
	};

	return (
		<div className="rounded-sm border border-warning-border bg-warning-surface px-2.5 py-2 text-xs text-warning-foreground">
			<div className="flex items-start gap-2">
				<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border border-warning-border bg-ide-toolbar">
					<ShieldAlert className="size-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="font-medium">需要确认工具权限</p>
							<p className="mt-0.5 text-caption text-muted-foreground">
								工具类型
								<span className="ml-1 rounded-sm border border-warning-border px-1 py-0.5 font-mono text-2xs">
									{kind}
								</span>
							</p>
						</div>
						<time className="shrink-0 text-caption text-muted-foreground" dateTime={createdAtValue}>
							{createdAt.toLocaleTimeString("zh-CN", {
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							})}
						</time>
					</div>
					<div className="mt-2 rounded-sm border border-warning-border/70 bg-ide-editor px-2 py-1.5">
						<p className="text-caption text-muted-foreground">智能体请求执行</p>
						<pre
							aria-label="权限请求执行内容"
							className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-caption leading-5 text-foreground"
						>
							{title}
						</pre>
					</div>
					<div className="mt-2 flex flex-wrap justify-end gap-1.5 border-t border-warning-border/70 pt-2">
						{request.options.map((option) => (
							<Button
								key={option.optionId}
								type="button"
								size="sm"
								variant={option.kind.startsWith("allow") ? "default" : "outline"}
								className="h-7 max-w-full rounded-sm"
								disabled={disabled}
								onClick={() => void decide(option.optionId)}
							>
								{decidingOptionId === option.optionId ? (
									<Loader2 className="mr-1 size-3 animate-spin" />
								) : null}
								<span className="block min-w-0 max-w-56 truncate">
									{option.name || option.kind}
								</span>
							</Button>
						))}
					</div>
					{errorMessage ? (
						<p className="mt-2 rounded-sm border border-error-border bg-error-surface px-2 py-1 text-error-foreground">
							{errorMessage}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};

const getPermissionDecisionError = (err: unknown) => {
	if (err instanceof Error && err.message) return err.message;
	if (err && typeof err === "object" && "message" in err) {
		const message = (err as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "权限请求已失效或运行时没有返回确认结果。";
};

const isStalePermissionRequestError = (err: unknown, message: string) => {
	const code =
		err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
	if (code === 404) return true;
	const normalized = message.toLowerCase();
	return (
		normalized.includes("not found") ||
		normalized.includes("session not found") ||
		normalized.includes("request not found") ||
		message.includes("不存在") ||
		message.includes("已失效")
	);
};
