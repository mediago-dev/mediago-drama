import type { AgentRuntimeACPPermissionRequest } from "@/domains/agent/api/agent";
import { isTauriRuntime } from "@/shared/lib/api-base";

export type AgentPermissionNotificationResult = "shown" | "fallback";

export const showAgentPermissionSystemNotification = async (
	request: AgentRuntimeACPPermissionRequest,
	onClick: () => void,
): Promise<AgentPermissionNotificationResult> => {
	if (isTauriRuntime()) {
		const result = await showTauriNotification(request);
		if (result === "shown") return result;
	}

	if (!supportsSystemNotifications()) return "fallback";

	const permission =
		Notification.permission === "default"
			? await Notification.requestPermission()
			: Notification.permission;
	if (permission !== "granted") return "fallback";

	const notification = new Notification("Agent 等待权限确认", {
		body: notificationBody(request),
		requireInteraction: true,
		tag: `agent-permission-${request.requestId}`,
	});
	notification.onclick = () => {
		onClick();
		notification.close();
	};
	return "shown";
};

const showTauriNotification = async (
	request: AgentRuntimeACPPermissionRequest,
): Promise<AgentPermissionNotificationResult> => {
	try {
		const { isPermissionGranted, requestPermission, sendNotification } =
			await import("@tauri-apps/plugin-notification");
		const permissionGranted =
			(await isPermissionGranted()) || (await requestPermission()) === "granted";
		if (!permissionGranted) return "fallback";
		sendNotification({
			title: "Agent 等待权限确认",
			body: notificationBody(request),
			group: "agent-permissions",
			autoCancel: true,
		});
		return "shown";
	} catch {
		return "fallback";
	}
};

const supportsSystemNotifications = () =>
	typeof window !== "undefined" && "Notification" in window && typeof Notification === "function";

const notificationBody = (request: AgentRuntimeACPPermissionRequest) => {
	const title = request.toolCall?.title || request.toolCall?.id || "工具调用";
	return truncateNotificationText(`智能体请求执行 ${title}，需要确认后继续。`);
};

const truncateNotificationText = (value: string) =>
	value.length > 180 ? `${value.slice(0, 177)}...` : value;
