import { isDesktopRuntime } from "@/shared/lib/api-base";
import { showDesktopNotification } from "@/shared/desktop/actions";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";

export type GenerationSystemNotificationResult = "shown" | "fallback";

export const showGenerationSuccessSystemNotification = async (
	notification: GenerationSuccessNotification,
): Promise<GenerationSystemNotificationResult> => {
	return showGenerationSystemNotification({
		title: notification.title,
		body: truncateNotificationText(notification.description),
	});
};

export const showGenerationTaskCompletedSystemNotification =
	async (): Promise<GenerationSystemNotificationResult> =>
		showGenerationSystemNotification({
			title: "生成完成",
			body: "生成任务已完成。",
		});

const showGenerationSystemNotification = async ({
	body,
	title,
}: {
	body: string;
	title: string;
}): Promise<GenerationSystemNotificationResult> => {
	if (!isDesktopRuntime()) return "fallback";

	const shown = await showDesktopNotification({
		title,
		body,
		group: "generation-success",
		autoCancel: true,
	});
	return shown ? "shown" : "fallback";
};

const truncateNotificationText = (value: string) =>
	value.length > 180 ? `${value.slice(0, 177)}...` : value;
