import { isDesktopRuntime } from "@/shared/lib/api-base";
import { showDesktopNotification } from "@/shared/desktop/actions";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";

export type GenerationSystemNotificationResult = "shown" | "fallback";

export const showGenerationSuccessSystemNotification = async (
	notification: GenerationSuccessNotification,
): Promise<GenerationSystemNotificationResult> => {
	if (!isDesktopRuntime()) return "fallback";

	const shown = await showDesktopNotification({
		title: notification.title,
		body: truncateNotificationText(notification.description),
		group: "generation-success",
		autoCancel: true,
	});
	return shown ? "shown" : "fallback";
};

const truncateNotificationText = (value: string) =>
	value.length > 180 ? `${value.slice(0, 177)}...` : value;
