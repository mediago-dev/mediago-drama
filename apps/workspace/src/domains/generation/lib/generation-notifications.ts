import { isTauriRuntime } from "@/shared/lib/api-base";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";

export type GenerationSystemNotificationResult = "shown" | "fallback";

export const showGenerationSuccessSystemNotification = async (
	notification: GenerationSuccessNotification,
): Promise<GenerationSystemNotificationResult> => {
	if (!isTauriRuntime()) return "fallback";

	try {
		const { isPermissionGranted, requestPermission, sendNotification } =
			await import("@tauri-apps/plugin-notification");
		const permissionGranted =
			(await isPermissionGranted()) || (await requestPermission()) === "granted";
		if (!permissionGranted) return "fallback";

		sendNotification({
			title: notification.title,
			body: truncateNotificationText(notification.description),
			group: "generation-success",
			autoCancel: true,
		});
		return "shown";
	} catch {
		return "fallback";
	}
};

const truncateNotificationText = (value: string) =>
	value.length > 180 ? `${value.slice(0, 177)}...` : value;
