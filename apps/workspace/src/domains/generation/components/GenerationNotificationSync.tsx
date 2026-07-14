import { useEffect } from "react";
import { mutate as mutateSWR } from "swr";
import {
	createGenerationNotificationEventSource,
	generationConversationsKey,
	generationTasksKey,
	getGenerationNotifications,
	type GenerationNotificationEvent,
} from "@/domains/generation/api/generation";
import { refreshSelectedGenerationAssetDependents } from "@/domains/generation/lib/refresh-selected-assets";
import {
	showGenerationSuccessSystemNotification,
	showGenerationTaskCompletedSystemNotification,
} from "@/domains/generation/lib/generation-notifications";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { mediaAssetsKey } from "@/domains/workspace/api/media";

const generationNotificationCompletedEventType = "generation.notification.completed";
// Fired for tasks that completed in the background without a tracked
// notification target (e.g. agent-submitted image tasks): no notification
// record, but resource covers/counts still need revalidating.
const generationTaskCompletedEventType = "generation.task.completed";

export const GenerationNotificationSync = () => {
	useEffect(() => {
		let closed = false;

		void getGenerationNotifications()
			.then((response) => {
				if (!closed) {
					useGenerationNotificationStore
						.getState()
						.setNotificationsFromServer(response.notifications);
				}
			})
			.catch(() => {
				// The live stream can still deliver new notifications after a transient list error.
			});

		const source = createGenerationNotificationEventSource();
		const handleCompleted = (event: MessageEvent<string>) => {
			const payload = parseGenerationNotificationEvent(event.data);
			if (!payload?.notification) return;

			revalidateGenerationCaches();
			refreshSelectedGenerationAssetDependents(payload.projectId || payload.notification.projectId);
			const result = useGenerationNotificationStore
				.getState()
				.upsertNotificationFromServer(payload.notification);
			if (result.inserted && result.notification && !result.notification.readAt) {
				void showGenerationSuccessSystemNotification(result.notification);
			}
		};
		const handleTaskCompleted = (event: MessageEvent<string>) => {
			const payload = parseGenerationNotificationEvent(event.data);
			if (!payload) return;
			revalidateGenerationCaches();
			refreshSelectedGenerationAssetDependents(payload.projectId);
			void showGenerationTaskCompletedSystemNotification();
		};

		source.addEventListener(generationNotificationCompletedEventType, handleCompleted);
		source.addEventListener(generationTaskCompletedEventType, handleTaskCompleted);
		return () => {
			closed = true;
			source.removeEventListener(generationNotificationCompletedEventType, handleCompleted);
			source.removeEventListener(generationTaskCompletedEventType, handleTaskCompleted);
			source.close();
		};
	}, []);

	return null;
};

const parseGenerationNotificationEvent = (value: string): GenerationNotificationEvent | null => {
	try {
		return JSON.parse(value) as GenerationNotificationEvent;
	} catch {
		return null;
	}
};

const revalidateGenerationCaches = () => {
	void mutateSWR(isGenerationTasksCacheKey, undefined, { revalidate: true });
	void mutateSWR(isGenerationConversationsCacheKey, undefined, { revalidate: true });
	void mutateSWR(isMediaAssetsCacheKey, undefined, { revalidate: true });
};

const isGenerationTasksCacheKey = (key: unknown) =>
	Array.isArray(key) && key[0] === generationTasksKey;

const isGenerationConversationsCacheKey = (key: unknown) =>
	Array.isArray(key) && key[0] === generationConversationsKey;

const isMediaAssetsCacheKey = (key: unknown) => Array.isArray(key) && key[0] === mediaAssetsKey;
