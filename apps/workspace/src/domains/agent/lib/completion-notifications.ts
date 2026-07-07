import { isDesktopRuntime } from "@/shared/lib/api-base";
import { showDesktopNotification } from "@/shared/desktop/actions";

export type AgentCompletionOutcome = "completed" | "failed";

export type AgentCompletionNotificationResult = "shown" | "fallback";

export const showAgentCompletionSystemNotification = async (
	outcome: AgentCompletionOutcome,
	summary: string | undefined,
	onClick: () => void,
): Promise<AgentCompletionNotificationResult> => {
	const title = notificationTitle(outcome);
	const body = notificationBody(outcome, summary);

	if (isDesktopRuntime()) {
		const shown = await showDesktopNotification({
			title,
			body,
			group: "agent-completion",
			autoCancel: true,
			onClick,
		});
		if (shown) return "shown";
	}

	if (!supportsSystemNotifications()) return "fallback";

	const permission =
		Notification.permission === "default"
			? await Notification.requestPermission()
			: Notification.permission;
	if (permission !== "granted") return "fallback";

	const notification = new Notification(title, { body, tag: "agent-completion" });
	notification.onclick = () => {
		onClick();
		notification.close();
	};
	return "shown";
};

const notificationTitle = (outcome: AgentCompletionOutcome) =>
	outcome === "failed" ? "Agent 运行失败" : "Agent 调用完成";

const notificationBody = (outcome: AgentCompletionOutcome, summary?: string) => {
	const trimmed = summary?.trim();
	if (trimmed) return truncateNotificationText(trimmed);
	return outcome === "failed"
		? "智能体本次运行失败，点击查看详情。"
		: "智能体已完成本次运行，点击查看结果。";
};

const supportsSystemNotifications = () =>
	typeof window !== "undefined" && "Notification" in window && typeof Notification === "function";

const truncateNotificationText = (value: string) =>
	value.length > 180 ? `${value.slice(0, 177)}...` : value;
