import { useEffect } from "react";
import { mutate as mutateSWR } from "swr";
import {
	createGenerationNotificationEventSource,
	generationConversationsKey,
	generationTasksKey,
	getGenerationNotifications,
	type GenerationNotificationEvent,
} from "@/domains/generation/api/generation";
import { showGenerationSuccessSystemNotification } from "@/domains/generation/lib/generation-notifications";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { mediaAssetsKey } from "@/domains/workspace/api/media";

const generationNotificationCompletedEventType = "generation.notification.completed";

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
			const result = useGenerationNotificationStore
				.getState()
				.upsertNotificationFromServer(payload.notification);
			if (result.inserted && result.notification && !result.notification.readAt) {
				void showGenerationSuccessSystemNotification(result.notification);
			}
		};

		source.addEventListener(generationNotificationCompletedEventType, handleCompleted);
		return () => {
			closed = true;
			source.removeEventListener(generationNotificationCompletedEventType, handleCompleted);
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
